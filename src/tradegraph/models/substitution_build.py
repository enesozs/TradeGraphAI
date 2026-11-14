"""`tradegraph substitution`: learn substitution capacity from history (ML A) and write marts.

Outputs (marts dir):
  substitution_events.parquet      every supplier-specific fall found, with the alternatives' realised expansion
  substitution_backtest.parquet    held-out alternative rows: realised growth vs learned quantiles and fixed alphas
  substitution_capacity.parquet    for the Scenario Studio year: learned q10/q50/q90 expansion per
                                   (basket, shocked supplier, alternative), for every shortfall size
  substitution_metrics.json        event rules, backtest metrics vs the fixed assumptions, caveats
"""

from __future__ import annotations

import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from tradegraph.config import BasketConfig, PipelineConfig
from tradegraph.curate import curated_dir
from tradegraph.marts import marts_dir
from tradegraph.models.substitution import (
    FEATURES,
    EventRules,
    alternative_features,
    evaluate,
    event_correlation,
    fit_calibrated,
    supplier_totals,
    training_table,
    training_table_sql,
)

SPLIT_YEAR = 2019  # train on falls whose following year is <= 2019; test on 2020-2024
MIN_WORLD_KUSD = 20_000  # all-products training: skip HS6 products with under $20 m of world trade


def load_flows(out: Path) -> pd.DataFrame:
    return duckdb.sql(
        f"SELECT basket_id, year, supplier_iso3, importer_iso3, value_kusd, quantity_t FROM '{out / 'supplier_basket_year.parquet'}'"
    ).df()


def build(cfg: PipelineConfig, baskets: BasketConfig, log=print) -> Path:
    out = marts_dir(cfg.data_dir, cfg.baci.release, cfg.baci.hs_revision)
    rules = EventRules()

    # 1. Training data: supplier-specific falls across EVERY HS6 product in curated BACI.
    con = duckdb.connect()
    glob = curated_dir(cfg.data_dir, cfg.baci) / "flows" / "*" / "*.parquet"
    con.execute(f"""CREATE VIEW fl AS SELECT year::INT AS year, product_code AS p, exporter AS e, importer AS i,
                    value_kusd AS v, quantity_t AS q FROM read_parquet('{glob}', hive_partitioning = true)""")
    _, alts_all = training_table_sql(con, "fl", rules, MIN_WORLD_KUSD)
    alts_all = alts_all.dropna(subset=["growth"])
    n_products = alts_all["basket_id"].nunique()
    log(f"substitution: all products -> {alts_all.groupby(['basket_id', 'shocked_iso3', 'year']).ngroups:,} falls "
        f"in {n_products:,} HS6 products, {len(alts_all):,} alternative rows")  # fmt: skip

    # 2. Basket-level falls (the products this app is about), for the page and an in-domain test.
    flows = load_flows(out)
    events, alts_b = training_table(flows, rules)
    log(f"substitution: baskets -> {len(events)} falls, {len(alts_b):,} alternative rows")

    # 3. Backtest: train on falls up to SPLIT_YEAR, test on later falls (all products, and baskets only).
    train = alts_all[alts_all["year"] + 1 <= SPLIT_YEAR]
    bt = fit_calibrated(train)
    m_all = evaluate(bt, alts_all[alts_all["year"] + 1 > SPLIT_YEAR])  # noqa: E501
    test_all = alts_all[alts_all["year"] + 1 > SPLIT_YEAR]
    rho = event_correlation(test_all, bt.predict(test_all))
    log(f"substitution: within-fall correlation of alternatives' surprises rho = {rho:.2f}")
    test_b = alts_b[alts_b["year"] + 1 > SPLIT_YEAR].copy()
    m_b = evaluate(bt, test_b) if len(test_b) >= 20 else None
    for name, m in [("all products", m_all), ("baskets", m_b)]:
        if not m:
            continue
        log(f"backtest ({name}, {m['n_events']} held-out falls, size-weighted):")
        for k, v in m["models"].items():
            log(f"  {k:12s} MAE {v['mae_median']:.3f}  aggregate error {v['aggregate_error']:.3f}")
        log(f"  q10-q90 coverage {m['coverage_q10_q90']:.2f} (target 0.80; band widened x{bt.k:.2f})")

    # Realised expansion per basket fall, and held-out basket predictions, for the page.
    alts_b["expansion_kusd"] = np.maximum(alts_b["growth"], 0) * alts_b["value_kusd"]
    real = alts_b.groupby(["basket_id", "shocked_iso3", "year"], as_index=False).agg(
        alternatives=("alternative_iso3", "count"), alt_exports_kusd=("value_kusd", "sum"),
        expansion_kusd=("expansion_kusd", "sum"), median_growth=("growth", "median"))  # fmt: skip
    ev = events.rename(columns={"supplier_iso3": "shocked_iso3"}).merge(
        real, on=["basket_id", "shocked_iso3", "year"], how="left"
    )
    ev["realised_alpha"] = ev["expansion_kusd"] / ev["alt_exports_kusd"]
    ev["gap_filled_share"] = (ev["expansion_kusd"] / ev["lost_kusd"].where(ev["lost_kusd"] > 0)).clip(upper=5)
    ev.to_parquet(out / "substitution_events.parquet", index=False)
    if len(test_b):
        pb = bt.predict(test_b)
        test_b[["q10", "q50", "q90", "mean_pos"]] = pb[["q10", "q50", "q90", "mean_pos"]].to_numpy()
        test_b[["basket_id", "shocked_iso3", "year", "alternative_iso3", "value_kusd", "tonnes_basis", "growth",
                "q10", "q50", "q90", "mean_pos"]].to_parquet(out / "substitution_backtest.parquet", index=False)  # fmt: skip

    # 4. Final model on all history -> per-alternative capacities for the Scenario Studio grid.
    model = fit_calibrated(alts_all)
    tot = supplier_totals(flows)
    sc = cfg.scenarios
    world = tot[tot["year"] == sc.year].groupby("basket_id")["value_kusd"].sum()
    cap_rows = []
    for b in baskets.baskets:
        tb = tot[(tot["basket_id"] == b.id) & (tot["year"] == sc.year)].sort_values("value_kusd", ascending=False)
        for s in tb.head(sc.top_suppliers).itertuples():
            for shortfall in sc.shortfalls:
                gap = shortfall * s.value_kusd / world[b.id]
                feats = alternative_features(
                    flows, tot, b.id, s.supplier_iso3, sc.year, gap, s.world_share, rules, with_target=False
                )
                if feats.empty:
                    continue
                pred = model.predict(feats)
                for k, r in enumerate(feats.itertuples()):
                    cap_rows.append({"basket_id": b.id, "year": sc.year, "supplier_iso3": s.supplier_iso3,
                                     "shortfall": shortfall, "alternative_iso3": r.alternative_iso3,
                                     "exports_kusd": r.value_kusd,
                                     "alpha_expected": float(pred["mean_pos"].iloc[k]),
                                     "alpha_q10": max(0.0, float(pred["q10"].iloc[k])),
                                     "alpha_q50": max(0.0, float(pred["q50"].iloc[k])),
                                     "alpha_q90": max(0.0, float(pred["q90"].iloc[k]))})  # fmt: skip
    cap = pd.DataFrame(cap_rows)
    cap.to_parquet(out / "substitution_capacity.parquet", index=False)

    info = {
        "kind": "model (learned from observed history); used inside scenarios",
        "question": "When a major supplier's exports of a product fell, how much did the other suppliers expand theirs the next year?",
        "rules": {"drop": rules.drop, "min_share": rules.min_share, "world_floor": rules.world_floor,
                  "n_alternatives": rules.n_alternatives, "clip_max": rules.clip_max, "min_size_kusd": rules.min_size_kusd,
                  "min_world_kusd_all_products": MIN_WORLD_KUSD},
        "features": FEATURES,
        "training": {"scope": "all HS6 products in CEPII BACI with >= $20 m world trade", "n_products": int(n_products),
                     "n_falls": int(alts_all.groupby(["basket_id", "shocked_iso3", "year"]).ngroups),
                     "n_alternative_rows": int(len(alts_all)), "tonnes_basis_share": float(alts_all["tonnes_basis"].mean()),
                     "band_widening_k": model.k, "event_correlation": rho},
        "basket_falls": int(len(events)),
        "split_year": SPLIT_YEAR,
        "backtest_all_products": m_all,
        "backtest_baskets": m_b,
        "scenario_year": sc.year,
        "caveats": [
            "Observational: alternatives that grew after a rival's fall show what did happen, not what could happen in a sudden global shortfall.",
            "Learned across all HS6 products and applied to baskets (groups of HS6 codes); behaviour may differ for strategic goods.",
            "Growth is measured in tonnes where both years report tonnes, otherwise in current USD (prices move value).",
            "Falls are supplier-specific by construction (world exports held at >= 80% of the year before); their causes are not identified.",
            "Most training falls are smaller than the scenarios' shocks; large shocks are extrapolation.",
        ],
    }  # fmt: skip
    (out / "substitution_metrics.json").write_text(json.dumps(info, indent=2, default=float))
    log(f"substitution -> {out}: capacity rows {len(cap):,}")
    return out
