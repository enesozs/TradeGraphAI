"""`tradegraph gravity`: fit gravity per basket and write the gravity-relative network marts.

Outputs (next to the other marts):
  gravity_supplier.parquet : basket, year, importer, supplier, value, expected, share_obs, share_exp, intensity
  network_nodes.parquet    : basket, year, country, exports/imports observed vs expected, supplier centrality
                             (PageRank) observed vs expected
  network_edges.parquet    : top edges per basket-year by observed value, with expected value
  gravity_fit.json         : coefficients, fit stats, robustness run (smallest economies excluded)
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from tradegraph.config import BasketConfig, PipelineConfig
from tradegraph.curate import curated_dir as baci_curated
from tradegraph.marts import marts_dir
from tradegraph.metrics.network import communities, supplier_centrality
from tradegraph.models import gravity
from tradegraph.models.covariates import curated_dir as grav_curated

TOP_EDGES = 250
MIN_EXP_SHARE = 0.01


def _connect(cfg: PipelineConfig, baskets: BasketConfig) -> duckdb.DuckDBPyConnection:
    cur, gcur = baci_curated(cfg.data_dir, cfg.baci), grav_curated(cfg.data_dir, cfg.gravity.release)
    con = duckdb.connect()
    con.execute(f"""
        CREATE VIEW flows AS SELECT * FROM read_parquet('{cur}/flows/*/*.parquet');
        CREATE TABLE dim_country AS SELECT * FROM '{cur / "dim_country.parquet"}';
        CREATE TABLE gpairs AS SELECT * FROM '{gcur / "pairs.parquet"}';
        CREATE TABLE grta AS SELECT * FROM '{gcur / "rta.parquet"}';
        CREATE TABLE universe AS
          SELECT DISTINCT year, exporter AS country_code FROM flows
          UNION SELECT DISTINCT year, importer FROM flows;
        CREATE TABLE country_size AS  -- average yearly total trade (all products), for the robustness run
          SELECT c AS country_code, sum(v) / count(DISTINCT year) AS avg_trade FROM (
            SELECT year, exporter AS c, value_kusd AS v FROM flows UNION ALL SELECT year, importer, value_kusd FROM flows
          ) GROUP BY 1;
        CREATE TABLE basket_codes(basket_id VARCHAR, product_code VARCHAR);
    """)
    con.executemany("INSERT INTO basket_codes VALUES (?, ?)", baskets.rows())
    return con


def _network_tables(basket_id: str, exp: pd.DataFrame, resolution: float = 1.5) -> tuple[pd.DataFrame, pd.DataFrame]:
    nodes, edges = [], []
    for year, g in exp.groupby("year"):
        ids = np.union1d(g["exporter"].unique(), g["importer"].unique())
        idx = {c: k for k, c in enumerate(ids)}
        n = len(ids)
        obs, fit = np.zeros((n, n)), np.zeros((n, n))
        e, i = g["exporter"].map(idx).to_numpy(), g["importer"].map(idx).to_numpy()
        obs[e, i], fit[e, i] = g["value"].to_numpy(), g["expected"].to_numpy()
        c_obs, c_exp = supplier_centrality(obs), supplier_centrality(fit)
        comm = communities(obs, seed=0, resolution=resolution)
        nodes.append(
            pd.DataFrame(
                {
                    "basket_id": basket_id,
                    "year": year,
                    "country": ids,
                    "exports_kusd": obs.sum(1),
                    "exports_expected_kusd": fit.sum(1),
                    "imports_kusd": obs.sum(0),
                    "imports_expected_kusd": fit.sum(0),
                    "centrality": c_obs,
                    "centrality_expected": c_exp,
                    "community": comm,
                }
            )
        )
        top = g[g["value"] > 0].nlargest(TOP_EDGES, "value")
        edges.append(top.assign(basket_id=basket_id))
    return pd.concat(nodes), pd.concat(edges)


def _supplier_table(basket_id: str, exp: pd.DataFrame) -> pd.DataFrame:
    d = exp.copy()
    grp = d.groupby(["year", "importer"])
    d["share_obs"] = d["value"] / grp["value"].transform("sum")
    d["share_exp"] = d["expected"] / grp["expected"].transform("sum")
    d = d[(d["value"] > 0) | (d["share_exp"] >= MIN_EXP_SHARE)].copy()
    d["intensity"] = np.where(d["share_exp"] > 0, d["share_obs"] / d["share_exp"], np.nan)
    return d.rename(columns={"exporter": "supplier"}).assign(basket_id=basket_id)


def build(cfg: PipelineConfig, baskets: BasketConfig, log=print) -> Path:
    out = marts_dir(cfg.data_dir, cfg.baci.release, cfg.baci.hs_revision)
    out.mkdir(parents=True, exist_ok=True)
    con = _connect(cfg, baskets)
    q = cfg.gravity.sensitivity_drop_smallest_share
    exclude = (
        f"WHERE country_code NOT IN (SELECT country_code FROM country_size "
        f"WHERE avg_trade <= (SELECT quantile_cont(avg_trade, {q}) FROM country_size))"
    )
    fits, sups, nodes, edges = {}, [], [], []
    for b in baskets.baskets:
        panel = gravity.load_panel(con, b.id)
        main = gravity.estimate(panel, b.id)
        robust = gravity.estimate(gravity.load_panel(con, b.id, exclude), b.id)
        # Robustness: compare expected supplier shares on pairs present in both runs.
        m = _supplier_table(b.id, main.expected)
        r = _supplier_table(b.id, robust.expected)
        joined = m.merge(r, on=["year", "importer", "supplier"], suffixes=("", "_r"))
        # Importers whose expected imports sum to 0 (fixed effects dropped) have undefined shares: exclude them.
        joined = joined[np.isfinite(joined["share_exp"]) & np.isfinite(joined["share_exp_r"])]
        share_corr = float(np.corrcoef(joined["share_exp"], joined["share_exp_r"])[0, 1]) if len(joined) > 2 else None
        fits[b.id] = {
            "label": b.label,
            "main": {
                "coefficients": main.coefficients,
                "n_obs": main.n_obs,
                "n_dropped": main.n_dropped,
                "n_rows_without_covariates": main.n_pairs_without_covariates,
                "corr_obs_fitted_positive": main.corr_obs_fitted,
                "unpredicted_value_share": main.unpredicted_value_share,
            },
            "robustness_drop_smallest": {
                "share_excluded": q,
                "coefficients": robust.coefficients,
                "n_obs": robust.n_obs,
                "corr_expected_shares_vs_main": share_corr,
            },
        }
        sups.append(m)
        nd, ed = _network_tables(b.id, main.expected, cfg.gravity.community_resolution)
        nodes.append(nd)
        edges.append(ed)
        ld = main.coefficients.get("ldist", {}).get("estimate", float("nan"))
        log(
            f"gravity {b.id}: n={main.n_obs:,} ldist={ld:.2f} robust-corr={share_corr if share_corr is None else round(share_corr, 3)}"
        )

    con.register("sup", pd.concat(sups))
    con.register("nodes", pd.concat(nodes))
    con.register("edges", pd.concat(edges))
    prov = ",".join(str(y) for y in cfg.baci.provisional_years) or "NULL"
    con.execute(f"""
        COPY (SELECT s.basket_id, s.year, s.importer, ci.iso3 AS importer_iso3, s.supplier, cs.iso3 AS supplier_iso3,
                     cs.country_name AS supplier_name, s.value AS value_kusd, s.expected AS expected_kusd,
                     s.share_obs, s.share_exp, s.intensity, s.year IN ({prov}) AS is_provisional
              FROM sup s JOIN dim_country ci ON ci.country_code = s.importer
              JOIN dim_country cs ON cs.country_code = s.supplier
              ORDER BY basket_id, importer_iso3, year, share_obs DESC)
          TO '{out / "gravity_supplier.parquet"}' (FORMAT parquet, COMPRESSION zstd);
        COPY (SELECT n.*, c.iso3, c.country_name, n.year IN ({prov}) AS is_provisional
              FROM nodes n JOIN dim_country c ON c.country_code = n.country
              ORDER BY basket_id, year, centrality DESC)
          TO '{out / "network_nodes.parquet"}' (FORMAT parquet, COMPRESSION zstd);
        COPY (SELECT c.country_code, c.iso3, c.country_name, g.iso_num
              FROM dim_country c
              LEFT JOIN '{grav_curated(cfg.data_dir, cfg.gravity.release) / "countries.parquet"}' g
                ON g.iso3 = CASE c.iso3 WHEN 'S19' THEN 'TWN' ELSE c.iso3 END
              -- BACI lists historical entities under current ISO3 codes (e.g. 280 "Fed. Rep. of Germany (...1990)"
              -- under DEU); keep one row per ISO3, preferring the current entity.
              QUALIFY row_number() OVER (PARTITION BY c.iso3 ORDER BY c.country_name LIKE '%(...%', c.country_code) = 1
              ORDER BY c.iso3)
          TO '{out / "country_geo.parquet"}' (FORMAT parquet);
        COPY (SELECT e.basket_id, e.year, ce.iso3 AS exporter_iso3, ci.iso3 AS importer_iso3,
                     e.value AS value_kusd, e.expected AS expected_kusd
              FROM edges e JOIN dim_country ce ON ce.country_code = e.exporter
              JOIN dim_country ci ON ci.country_code = e.importer
              ORDER BY basket_id, year, value_kusd DESC)
          TO '{out / "network_edges.parquet"}' (FORMAT parquet, COMPRESSION zstd);
    """)
    (out / "gravity_fit.json").write_text(
        json.dumps(
            {
                "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "formula": gravity.FORMULA,
                "assumption": "Unrecorded country pairs are zero inside the gravity model only (PPML).",
                "covariates": f"CEPII Gravity V{cfg.gravity.release}; RTA after its last year carried forward: "
                f"{cfg.gravity.rta_carry_forward}; S19 (Other Asia, nes) uses TWN covariates.",
                "baskets": fits,
            },
            indent=1,
        )
    )
    log(f"gravity marts -> {out}")
    return out
