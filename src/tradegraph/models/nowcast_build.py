"""`tradegraph nowcast`: EU nowcast on the BACI basis (ML B) and its backtest.

Outputs (marts dir):
  nowcast_totals.parquet     reporter x basket x year: BACI observed totals (2012-latest) and nowcast totals for the
                             years BACI lacks, with a 10-90% band from the backtest errors
  nowcast_suppliers.parquet  reporter x basket x nowcast year x partner: nowcast value and share, with the latest
                             BACI share for comparison
  nowcast_metrics.json       backtest per setting (full year / partial year) and method, band widths, caveats
"""

from __future__ import annotations

import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from tradegraph.config import BasketConfig, PipelineConfig
from tradegraph.ingestion import fx
from tradegraph.marts import marts_dir
from tradegraph.models import nowcast as nc

# Comext reporter -> (label, BACI importer ISO3 or None for the EU bloc's imports from outside the EU)
REPORTERS = {
    "EU27_2020_EXTRA": ("EU, imports from outside the EU", None),
    "DE": ("Germany", "DEU"), "FR": ("France", "FRA"), "IT": ("Italy", "ITA"),
    "NL": ("Netherlands", "NLD"), "ES": ("Spain", "ESP"), "PL": ("Poland", "POL"),
}  # fmt: skip
EU27 = ["AUT", "BEL", "BGR", "CYP", "CZE", "DEU", "DNK", "EST", "ESP", "FIN", "FRA", "GRC", "HRV", "HUN", "IRL",
        "ITA", "LTU", "LUX", "LVA", "MLT", "NLD", "POL", "PRT", "ROU", "SWE", "SVN", "SVK"]  # fmt: skip
FIRST_TEST_YEAR = 2019


def _baci(out: Path) -> pd.DataFrame:
    """BACI flows per (reporter, partner, basket, year) on the same scope as each Comext reporter."""
    eu = ",".join(f"'{c}'" for c in EU27)
    members = ",".join(f"('{k}', '{v[1]}')" for k, v in REPORTERS.items() if v[1])
    return duckdb.sql(f"""
      WITH s AS (SELECT * FROM '{out / "supplier_basket_year.parquet"}')
      SELECT 'EU27_2020_EXTRA' AS reporter, supplier_iso3 AS partner_iso3, basket_id, year, sum(value_kusd) AS value_kusd
      FROM s WHERE importer_iso3 IN ({eu}) AND supplier_iso3 NOT IN ({eu}) GROUP BY ALL
      UNION ALL
      SELECT m.reporter, s.supplier_iso3, s.basket_id, s.year, s.value_kusd
      FROM s JOIN (VALUES {members}) m(reporter, iso3) ON s.importer_iso3 = m.iso3
    """).df()  # noqa: S608


def _comext(out: Path, rates: pd.DataFrame) -> pd.DataFrame:
    # Recorded values only (12-month-only rows have no value_eur). The mart holds fully published months only.
    m = duckdb.sql(f"""SELECT reporter, basket_id, partner_iso3, year(month) AS year, month(month) AS month, value_eur
                       FROM '{out / "comext_supplier.parquet"}'
                       WHERE reporter IN ({",".join(f"'{r}'" for r in REPORTERS)}) AND value_eur IS NOT NULL""").df()  # noqa: S608
    m = m.merge(rates, on=["year", "month"], how="inner")
    m["value_usd"] = m["value_eur"] * m["usd_per_eur"]
    return m


def _annualised(monthly: pd.DataFrame, upto: int | None, share_before: int | None) -> pd.DataFrame:
    """Comext k USD per pair-year; if ``upto`` is given, months 1..upto scaled up by the seasonal share."""
    a = nc.annual(monthly, upto)
    if upto is not None:
        sh = nc.seasonal_share(monthly, upto, before_year=share_before)
        a = a.merge(sh, on=["reporter", "basket_id"], how="left").fillna({"share": upto / 12})
        a["value_usd"] = a["value_usd"] / a["share"]
    a["comext_kusd"] = a["value_usd"] / 1e3
    return a[[*nc.KEYS, "year", "comext_kusd"]]


def common_cutoff(monthly: pd.DataFrame, reporters: list[str]) -> tuple[int, int]:
    """(year, month) of the last month published for EVERY reporter: the earliest of their latest months.

    Cutting all reporters there means each year before the cutoff year is complete for everyone, and no reporter drops
    out of the current year because its newest months are still held back. Raises if a reporter has no data at all.
    """
    last = (monthly["year"] * 12 + monthly["month"] - 1).groupby(monthly["reporter"]).max()
    missing = sorted(set(reporters) - set(last.index))
    if missing:
        raise ValueError(f"no published Comext months for {missing}")
    idx = int(last.loc[reporters].min())
    return idx // 12, idx % 12 + 1


def _training(monthly, full, baci_known, upto, share_before, max_year, reporters, baskets) -> pd.DataFrame:
    part = _annualised(monthly, upto, share_before)
    rows = pd.concat([nc.features(full, baci_known, 1), nc.features(full, baci_known, 2),
                      nc.features(part, baci_known, 2, partial=True)])  # fmt: skip
    rows = rows[(rows["year"] <= max_year) & np.isfinite(rows["log_ratio"])]
    return nc.encode(rows, reporters, baskets)


def build(cfg: PipelineConfig, baskets: BasketConfig, log=print) -> Path:
    out = marts_dir(cfg.data_dir, cfg.baci.release, cfg.baci.hs_revision)
    rates = fx.load(fx.raw_path(cfg.data_dir))
    monthly = _comext(out, rates)
    baci = _baci(out)
    reporters, bids = list(REPORTERS), sorted(baci["basket_id"].unique())
    totals_real = (
        baci.groupby(["reporter", "basket_id", "year"], as_index=False)["value_kusd"]
        .sum()
        .rename(columns={"value_kusd": "real"})
    )
    baci_last = int(baci["year"].max())
    # All reporters stop at the same month: the last one published for every reporter.
    comext_last_year, upto = common_cutoff(monthly, reporters)
    monthly = monthly[
        (monthly["year"] < comext_last_year) | ((monthly["year"] == comext_last_year) & (monthly["month"] <= upto))
    ]
    full = _annualised(monthly[monthly["year"] < comext_last_year], None, None)
    log(f"nowcast: Comext {monthly['year'].min()}-{comext_last_year} (last year to month {upto}); BACI to {baci_last}")

    # Backtest. "full_lag1" mimics the first missing BACI year (complete Comext year, BACI one year behind);
    # "partial_lag2" mimics the second (Comext January-<upto> scaled up, BACI two years behind).
    settings = {"full_lag1": (None, 1), "partial_lag2": (upto, 2)}
    bt_tot, bt_share = [], []
    for name, (part_upto, lag) in settings.items():
        for y in range(FIRST_TEST_YEAR, baci_last + 1):
            known = baci[baci["year"] <= y - lag]
            train = _training(monthly, full, known, upto, y, y - lag, reporters, bids)
            if train["last_log_ratio"].notna().sum() < 200:  # too early: no ratio history to learn from yet
                continue
            model = nc.fit(train)
            if part_upto is None:
                test_c = full[full["year"] == y]
            else:  # months 1..upto of year y, scaled up by the seasonal share of earlier complete years
                test_c = _annualised(monthly[monthly["year"] <= y], part_upto, y)
                test_c = test_c[test_c["year"] == y]
            # History features need the earlier years' Comext values next to BACI: prepend them.
            hist_c = pd.concat([full[full["year"] < y], test_c])
            test = nc.encode(nc.features(hist_c, known, lag, partial=part_upto is not None), reporters, bids)
            test = test[test["year"] == y]
            for method in nc.METHODS:
                pred = nc.predict(model, test, method)
                e = nc.totals_error(test, pred, totals_real)
                bt_tot.append(e.assign(setting=name, method=method, test_year=y))
                s = nc.top_share_error(test, pred, baci[baci["year"] == y])
                bt_share.append(s.assign(setting=name, method=method, test_year=y))
    bt_tot, bt_share = pd.concat(bt_tot), pd.concat(bt_share)

    metrics = {}
    for name in settings:
        metrics[name] = {}
        for method in nc.METHODS:
            t = bt_tot[(bt_tot.setting == name) & (bt_tot.method == method)]
            s = bt_share[(bt_share.setting == name) & (bt_share.method == method)]
            w = np.sqrt(t["real"])
            metrics[name][method] = {
                "median_abs_error": float(np.median(np.abs(np.expm1(t["log_error"])))),
                "weighted_abs_log_error": float(np.average(np.abs(t["log_error"]), weights=w)),
                "top_supplier_share_mae_pp": float(np.mean(np.abs(s["pp_error"])) * 100),
                "n_cells": int(len(t)),
            }
        lr = bt_tot[(bt_tot.setting == name) & (bt_tot.method == "learned")]["log_error"]
        metrics[name]["band_log"] = [float(np.quantile(lr, 0.1)), float(np.quantile(lr, 0.9))]
        log(f"backtest {name}: " + ", ".join(f"{m} {metrics[name][m]['median_abs_error']:.1%}" for m in nc.METHODS))

    # Final nowcasts: every Comext year BACI lacks.
    targets = [(y, None, y - baci_last) for y in range(baci_last + 1, comext_last_year)]  # complete Comext years
    targets.append((comext_last_year, upto, comext_last_year - baci_last))  # the current, incomplete year
    tot_rows, sup_rows = [], []
    for y, part_upto, lag in targets:
        lag_eff = max(1, min(lag, 2))
        setting = "full_lag1" if part_upto is None else "partial_lag2"
        train = _training(monthly, full, baci, upto, y, baci_last, reporters, bids)
        model = nc.fit(train)
        rows_c = (
            full[full["year"] == y] if part_upto is None else _annualised(monthly, part_upto, y).query("year == @y")
        )
        hist_c = pd.concat([full[full["year"] < y], rows_c])
        rows = nc.encode(nc.features(hist_c, baci, lag_eff, partial=part_upto is not None), reporters, bids)
        rows = rows[rows["year"] == y].copy()
        rows["pred"] = nc.predict(model, rows, "learned")
        lo, hi = metrics[setting]["band_log"]
        for (r, b), g in rows.groupby(["reporter", "basket_id"]):
            v = g["pred"].sum()
            tot_rows.append({"reporter": r, "basket_id": b, "year": y, "kind": "nowcast", "value_kusd": v,
                             "lo_kusd": v / np.exp(hi), "hi_kusd": v / np.exp(lo),
                             "months": 12 if part_upto is None else part_upto})  # fmt: skip
            for p in g.itertuples():
                sup_rows.append({"reporter": r, "basket_id": b, "year": y, "partner_iso3": p.partner_iso3,
                                 "value_kusd": p.pred, "share": p.pred / v if v else np.nan})  # fmt: skip
    obs = totals_real.rename(columns={"real": "value_kusd"}).assign(
        kind="observed", lo_kusd=np.nan, hi_kusd=np.nan, months=12
    )
    obs["provisional"] = obs["year"].isin(_provisional(out))
    totals = pd.concat([obs, pd.DataFrame(tot_rows).assign(provisional=False)], ignore_index=True)
    totals["reporter_label"] = totals["reporter"].map(lambda r: REPORTERS[r][0])
    totals.to_parquet(out / "nowcast_totals.parquet", index=False)
    sup = pd.DataFrame(sup_rows)
    last_share = baci[baci["year"] == baci_last].assign(
        baci_share=lambda d: d["value_kusd"] / d.groupby(["reporter", "basket_id"])["value_kusd"].transform("sum")
    )
    sup = sup.merge(
        last_share[["reporter", "basket_id", "partner_iso3", "baci_share"]],
        on=["reporter", "basket_id", "partner_iso3"],
        how="left",
    )
    sup.to_parquet(out / "nowcast_suppliers.parquet", index=False)

    info = {
        "kind": "nowcast (model estimate of observed data not yet published)",
        "scope": "EU only: the EU's imports from outside the EU, and six member states (DE, FR, IT, NL, ES, PL)",
        "baci_last_year": baci_last, "comext_last_year": comext_last_year, "comext_last_month": upto,
        "nowcast_years": [t[0] for t in targets],
        "methods": {"fx_only": "Comext at the exchange rate (ratio 1)", "last_ratio": "Comext x the pair's last known BACI/Comext ratio",
                    "learned": "gradient boosting on last known ratios, size, lag, reporter and basket"},
        "backtest": {"test_years": [FIRST_TEST_YEAR, baci_last], "settings": {
            "full_lag1": "complete Comext year, BACI one year behind (like the first nowcast year)",
            "partial_lag2": f"Comext January-month {upto} scaled up, BACI two years behind (like the current year)"},
            "metrics": metrics},
        "sources": ["CEPII BACI (target, history)", "Eurostat Comext DS-045409 (monthly, EUR)",
                    "Eurostat ert_bil_eur_m, based on ECB euro reference rates (USD per EUR)"],
        "caveats": [
            "A nowcast estimates what BACI will report; it is not observed data and will be revised when BACI publishes.",
            "BACI's latest year is itself provisional.",
            "Pairs that BACI records but Comext lacks are missing from the nowcast; the backtest error includes this.",
            "The current year is scaled up from its first months using each basket's usual seasonal pattern; a change in pattern (e.g. stockpiling) is not captured.",
            "Bands are the 10th-90th percentile of past nowcast errors, not a guarantee.",
        ],
    }  # fmt: skip
    (out / "nowcast_metrics.json").write_text(json.dumps(info, indent=2, default=float))
    log(f"nowcast -> {out}: {len(tot_rows)} nowcast totals, {len(sup_rows):,} supplier rows")
    return out


def _provisional(out: Path) -> list[int]:
    try:
        return json.loads((out / "build_info.json").read_text()).get("provisional_years", [])
    except FileNotFoundError:
        return []
