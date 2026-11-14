"""`tradegraph forecast`: chronological forecast benchmark (M4).

Folds: for each target year T, train on links with t+1 <= T-1 and test on links at t = T-1.
Validation folds come first; the holdout year is evaluated last and never informs any choice.
Revised-data caveat: BACI revises history, so this is a *retrospective* backtest, not point-in-time.
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
from tradegraph.forecast.features import build_features
from tradegraph.forecast.models import MODELS, POST_HOC_MODELS
from tradegraph.marts import marts_dir
from tradegraph.models import gravity
from tradegraph.models.build import _connect
from tradegraph.models.covariates import BACI_TO_GRAVITY_ISO3
from tradegraph.models.covariates import curated_dir as grav_curated

SIZE_BUCKETS = [(0, 1e3, "< $1 m"), (1e3, 1e4, "$1–10 m"), (1e4, 1e5, "$10–100 m"), (1e5, np.inf, "≥ $100 m")]
EXPORT_MIN_KUSD = 1e4  # predictions exported for the site: links ≥ $10 m in t or t+1


def split(df: pd.DataFrame, target_year: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    f = target_year - 1
    persistent = df["value_next"].notna()
    train = df[persistent & (df["year"] <= f - 1)]
    test = df[persistent & (df["year"] == f)]
    return train, test


def metrics(actual_next: np.ndarray, pred_log: np.ndarray) -> dict[str, float]:
    y = np.log1p(actual_next)
    err = pred_log - y
    usd = np.expm1(np.clip(pred_log, 0, None))
    return {
        "n": int(len(y)),
        "mae_log": float(np.mean(np.abs(err))),
        "rmse_log": float(np.sqrt(np.mean(err**2))),
        "wape_usd": float(np.sum(np.abs(usd - actual_next)) / np.sum(actual_next)),
        "bias_log": float(np.mean(err)),
    }


def rolling_gravity(cfg: PipelineConfig, baskets: BasketConfig, cutoffs: list[int], log=print) -> pd.DataFrame:
    """Expected flows for year c from a PPML fit on years <= c only (no look-ahead)."""
    con = _connect(cfg, baskets)
    out = []
    for b in baskets.baskets:
        panel = gravity.load_panel(con, b.id)
        for c in cutoffs:
            try:
                fit = gravity.estimate(panel[panel["year"] <= c].reset_index(drop=True), b.id)
            except (gravity.GravityError, ValueError) as e:  # e.g. too little data in early years
                log(f"  gravity {b.id} <= {c}: skipped ({e})")
                continue
            e = fit.expected
            out.append(
                e[e["year"] == c].assign(basket_id=b.id)[["basket_id", "year", "exporter", "importer", "expected"]]
            )
        log(f"  gravity rolling fits done: {b.id}")
    return pd.concat(out, ignore_index=True)


def _feature_table(cfg: PipelineConfig, grav: pd.DataFrame) -> pd.DataFrame:
    m = marts_dir(cfg.data_dir, cfg.baci.release, cfg.baci.hs_revision)
    cur, gcur = baci_curated(cfg.data_dir, cfg.baci), grav_curated(cfg.data_dir, cfg.gravity.release)
    remap = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in BACI_TO_GRAVITY_ISO3.items())
    con = duckdb.connect()
    con.register("grav", grav)
    con.execute(f"""
        CREATE TABLE links AS SELECT basket_id, year, supplier AS exporter, importer, value_kusd AS value
          FROM '{m / "supplier_basket_year.parquet"}';
        CREATE TABLE nodes AS SELECT basket_id, year, country, centrality FROM '{m / "network_nodes.parquet"}';
        CREATE TABLE cc AS SELECT country_code, CASE iso3 {remap} ELSE iso3 END AS giso FROM '{cur / "dim_country.parquet"}';
        CREATE TABLE cov AS
          SELECT a.country_code AS exporter, b.country_code AS importer, r.year,
                 ln(p.dist_km) AS ldist, p.contig, p.comlang_off AS comlang, p.colony, p.cov_missing, r.rta
          FROM cc a JOIN cc b ON a.country_code <> b.country_code
          JOIN '{gcur / "pairs.parquet"}' p ON p.iso3_o = a.giso AND p.iso3_d = b.giso
          JOIN '{gcur / "rta.parquet"}' r ON r.iso3_o = a.giso AND r.iso3_d = b.giso;
    """)
    return build_features(con)


def run(cfg: PipelineConfig, baskets: BasketConfig, log=print) -> Path:
    fc = cfg.forecast
    targets = [*fc.validation_years, fc.holdout_target_year]
    cutoffs = sorted({t - 1 for t in targets} | set(range(cfg.baci.years[0], fc.holdout_target_year)))
    log("forecast: rolling gravity fits (data <= t only)")
    grav = rolling_gravity(cfg, baskets, cutoffs, log)
    df = _feature_table(cfg, grav)
    log(f"forecast: {len(df):,} link-years; features built")

    folds, preds = [], []
    for t in targets:
        train, test = split(df, t)
        at_risk = df[df["year"] == t - 1]
        fold = {
            "target_year": t,
            "role": "holdout" if t == fc.holdout_target_year else "validation",
            "n_train": int(len(train)),
            "n_test": int(len(test)),
            "disappearance_rate": float(at_risk["value_next"].isna().mean()) if len(at_risk) else None,
            "models": {},
        }
        y = np.log1p(train["value_next"])
        for name, model in MODELS.items():
            p = model(train, y, test, fc.seed)
            fold["models"][name] = metrics(test["value_next"].to_numpy(), p)
            preds.append(
                test[["basket_id", "year", "exporter", "importer", "value", "value_next"]].assign(
                    target_year=t, model=name, pred_log=p, role=fold["role"]
                )
            )
        base = fold["models"]["persistence"]["mae_log"]
        for v in fold["models"].values():
            v["skill_vs_persistence"] = 1 - v["mae_log"] / base
        folds.append(fold)
        best = min(fold["models"], key=lambda k: fold["models"][k]["mae_log"])
        log(f"  T={t} ({fold['role']}): n_test={fold['n_test']:,} best={best}")

    allp = pd.concat(preds, ignore_index=True)
    breakdown = {}
    for role in ("validation", "holdout"):
        sub = allp[allp["role"] == role]
        breakdown[role] = {
            "pooled": {
                m: metrics(g["value_next"].to_numpy(), g["pred_log"].to_numpy()) for m, g in sub.groupby("model")
            },
            "by_basket": {
                f"{b}|{m}": metrics(g["value_next"].to_numpy(), g["pred_log"].to_numpy())
                for (b, m), g in sub.groupby(["basket_id", "model"])
            },
            "by_size": {
                f"{label}|{m}": metrics(g["value_next"].to_numpy(), g["pred_log"].to_numpy())
                for lo, hi, label in SIZE_BUCKETS
                for m, g in sub[(sub["value"] >= lo) & (sub["value"] < hi)].groupby("model")
            },
        }

    out = marts_dir(cfg.data_dir, cfg.baci.release, cfg.baci.hs_revision)
    (out / "forecast_metrics.json").write_text(
        json.dumps(
            {
                "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "target": "log1p(next-year value, k USD) for links recorded in both t and t+1",
                "caveat": "Retrospective backtest on revised BACI data (not point-in-time vintages).",
                "models": list(MODELS),
                "post_hoc_models": sorted(POST_HOC_MODELS),
                "post_hoc_note": "Added after the holdout was evaluated; their holdout scores are not a clean test.",
                "folds": folds,
                "breakdown": breakdown,
            },
            indent=1,
        )
    )
    con = duckdb.connect()
    con.register("p", allp[(allp["value"] >= EXPORT_MIN_KUSD) | (allp["value_next"] >= EXPORT_MIN_KUSD)])
    cur = baci_curated(cfg.data_dir, cfg.baci)
    con.execute(f"""
        COPY (SELECT p.basket_id, p.target_year, p.role, p.model, ce.iso3 AS exporter_iso3, ci.iso3 AS importer_iso3,
                     p.value AS value_t_kusd, p.value_next AS actual_kusd, (exp(greatest(p.pred_log, 0)) - 1) AS pred_kusd
              FROM p JOIN '{cur / "dim_country.parquet"}' ce ON ce.country_code = p.exporter
              JOIN '{cur / "dim_country.parquet"}' ci ON ci.country_code = p.importer
              ORDER BY basket_id, importer_iso3, exporter_iso3, target_year, model)
          TO '{out / "forecast_predictions.parquet"}' (FORMAT parquet, COMPRESSION zstd)
    """)
    log(f"forecast -> {out}")
    return out
