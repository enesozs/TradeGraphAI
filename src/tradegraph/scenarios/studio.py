"""`tradegraph scenarios`: precompute the L2 Scenario Studio grid for the static site.

Outputs (marts dir):
  scenario_summary.parquet   one row per (basket, supplier, shortfall, capacity) with global totals;
                             Monte Carlo p5/p50/p95 of total unmet demand where run
  scenario_importer.parquet  per affected importer: exposed, reallocated, unmet, unmet share of imports
  scenario_mc_importer.parquet  per importer: p5/p50/p95 unmet share (Monte Carlo shortfalls only), per method:
                             'assumed' (alpha ~ U(5%, 30%)) or 'learned' (ML A quantiles, correlated draws)
  scenario_flows.parquet     reallocation flows alternative -> importer (largest 300 per scenario)
"""

from __future__ import annotations

import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from tradegraph.config import BasketConfig, PipelineConfig
from tradegraph.marts import marts_dir
from tradegraph.models.substitution import sample_capacity
from tradegraph.scenarios.reallocation import CAPACITY_SETTINGS, LEARNED, monte_carlo, reallocate

MAX_FLOWS = 300


def _matrix(sup: pd.DataFrame) -> tuple[np.ndarray, list[str]]:
    ids = sorted(set(sup["supplier_iso3"]) | set(sup["importer_iso3"]))
    ix = {c: k for k, c in enumerate(ids)}
    f = np.zeros((len(ids), len(ids)))
    f[sup["supplier_iso3"].map(ix).to_numpy(), sup["importer_iso3"].map(ix).to_numpy()] = sup["value_kusd"].to_numpy()
    return f, ids


def _learned_rows(learned: pd.DataFrame | None, basket: str, supplier: str, shortfall: float) -> pd.DataFrame | None:
    if learned is None:
        return None
    r = learned[(learned.basket_id == basket) & (learned.supplier_iso3 == supplier) & (learned.shortfall == shortfall)]
    return r if len(r) else None


def _learned_mc(f: np.ndarray, s: int, shortfall: float, ids: list[str], lrows: pd.DataFrame, rho: float,
                draws: int, max_alternatives: int) -> tuple[np.ndarray, np.ndarray]:  # fmt: skip
    """Unmet demand per importer across correlated draws of the learned capacities."""
    ix = np.array([ids.index(a) for a in lrows.alternative_iso3])
    samples = sample_capacity(lrows[["alpha_q10", "alpha_q50", "alpha_q90"]].to_numpy(), rho, draws, seed=0)
    out, imps = [], np.array([], dtype=int)
    for d in samples:
        alpha_by = np.zeros(len(ids))
        alpha_by[ix] = d
        res, _, imps = reallocate(f, s, shortfall, LEARNED, max_alternatives, alpha_by=alpha_by)
        out.append(res.unmet)
    return np.array(out), imps


def build(cfg: PipelineConfig, baskets: BasketConfig, log=print) -> Path:
    sc = cfg.scenarios
    out = marts_dir(cfg.data_dir, cfg.baci.release, cfg.baci.hs_revision)
    sup_all = duckdb.sql(
        f"SELECT basket_id, supplier_iso3, importer_iso3, value_kusd FROM '{out / 'supplier_basket_year.parquet'}' WHERE year = {int(sc.year)}"
    ).df()
    summary, importers, mc_rows, flow_rows = [], [], [], []
    # ML A: learned per-alternative capacities, if `tradegraph substitution` has run.
    cap_path, met_path = out / "substitution_capacity.parquet", out / "substitution_metrics.json"
    learned = pd.read_parquet(cap_path) if cap_path.exists() else None
    rho = json.loads(met_path.read_text())["training"].get("event_correlation", 0.5) if met_path.exists() else 0.5
    for b in baskets.baskets:
        sup = sup_all[sup_all["basket_id"] == b.id]
        if sup.empty:
            continue
        f, ids = _matrix(sup)
        imports_total = f.sum(axis=0)
        top = np.argsort(-f.sum(axis=1))[: sc.top_suppliers]
        for s in top:
            for shortfall in sc.shortfalls:
                lrows = None
                if learned is not None:
                    lrows = learned[
                        (learned.basket_id == b.id)
                        & (learned.supplier_iso3 == ids[s])
                        & (learned.shortfall == shortfall)
                    ]
                runs = [(c, None) for c in CAPACITY_SETTINGS.values()]
                if lrows is not None and len(lrows):
                    alpha_by = np.zeros(len(ids))
                    ix = [ids.index(a) for a in lrows.alternative_iso3]
                    alpha_by[ix] = lrows.alpha_expected.to_numpy()
                    runs.append((LEARNED, alpha_by))
                for cap, alpha_by in runs:
                    res, alts, imps = reallocate(f, int(s), shortfall, cap, sc.max_alternatives, alpha_by=alpha_by)
                    key = {
                        "basket_id": b.id,
                        "year": sc.year,
                        "supplier_iso3": ids[s],
                        "shortfall": shortfall,
                        "capacity": cap.name,
                    }
                    summary.append({**key, "exposed_kusd": res.exposed.sum(), "reallocated_kusd": res.reallocated.sum(),
                                    "unmet_kusd": res.unmet.sum(), "fill_rate": res.fill_rate,
                                    "n_importers": len(imps), "n_alternatives_used": int((res.capacity_used > 1e-9).sum()),
                                    "alpha": cap.alpha if alpha_by is None else float(np.average(alpha_by[alts], weights=f.sum(axis=1)[alts])),
                                    "new_links": cap.allow_new_links})  # fmt: skip
                    for k, i in enumerate(imps):
                        importers.append({**key, "importer_iso3": ids[i], "imports_kusd": imports_total[i],
                                          "exposed_kusd": res.exposed[k], "reallocated_kusd": res.reallocated[k],
                                          "unmet_kusd": res.unmet[k], "unmet_share": res.unmet[k] / imports_total[i]})  # fmt: skip
                    a_i, i_i = np.nonzero(res.flows > 1e-6)
                    fl = sorted(zip(a_i, i_i, res.flows[a_i, i_i], strict=True), key=lambda t: -t[2])[:MAX_FLOWS]
                    for a, i, x in fl:
                        flow_rows.append({**key, "alternative_iso3": ids[alts[a]], "importer_iso3": ids[imps[i]],
                                          "reallocated_kusd": x, "existing_link": bool(f[alts[a], imps[i]] > 0)})  # fmt: skip
            for shortfall in sc.monte_carlo_shortfalls:
                # Assumed: alpha ~ U(5%, 30%) for every alternative. Learned (ML A): each alternative's growth drawn
                # from its learned quantiles, with a shared per-scenario factor (correlation rho from the backtest).
                assumed = monte_carlo(
                    f, int(s), shortfall, draws=sc.monte_carlo_draws, seed=0, max_alternatives=sc.max_alternatives
                )
                sims = [("assumed", assumed[:2])]
                lrows = _learned_rows(learned, b.id, ids[s], shortfall)
                if lrows is not None:
                    sims.append(
                        (
                            "learned",
                            _learned_mc(
                                f, int(s), shortfall, ids, lrows, rho, sc.monte_carlo_draws, sc.max_alternatives
                            ),
                        )
                    )
                for method, (unmet, imps) in sims:
                    q = np.percentile(unmet.sum(axis=1), [5, 50, 95])
                    for row in summary:
                        same = (row["basket_id"], row["supplier_iso3"], row["shortfall"]) == (b.id, ids[s], shortfall)
                        if same and (row["capacity"] == "learned") == (method == "learned"):
                            row.update({"mc_unmet_p5": q[0], "mc_unmet_p50": q[1], "mc_unmet_p95": q[2]})
                    qs = np.percentile(unmet / imports_total[imps], [5, 50, 95], axis=0)
                    for k, i in enumerate(imps):
                        mc_rows.append({"basket_id": b.id, "year": sc.year, "supplier_iso3": ids[s], "shortfall": shortfall,
                                        "method": method, "importer_iso3": ids[i], "unmet_share_p5": qs[0, k],
                                        "unmet_share_p50": qs[1, k], "unmet_share_p95": qs[2, k]})  # fmt: skip
        log(
            f"scenarios {b.id}: {len(top)} suppliers x {len(sc.shortfalls)} shortfalls x {3 + (learned is not None)} capacities (+ Monte Carlo)"
        )

    for name, rows in [("scenario_summary", summary), ("scenario_importer", importers),
                       ("scenario_mc_importer", mc_rows), ("scenario_flows", flow_rows)]:  # fmt: skip
        pd.DataFrame(rows).to_parquet(out / f"{name}.parquet", index=False)
    log(f"scenarios -> {out}: {len(summary)} scenarios, {len(importers):,} importer rows, {len(flow_rows):,} flows")
    return out
