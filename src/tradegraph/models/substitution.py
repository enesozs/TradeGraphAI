"""ML A: learned substitution capacity.

Question: when a major supplier of a product fell short, how much did the OTHER suppliers expand their exports
of that product the following year? The Scenario Studio assumes every alternative can divert a fixed share
alpha of its exports (5% / 15% / 30%). This module learns, from 2012-2024 history, a per-alternative expansion
as quantiles (q10 / q50 / q90), and benchmarks it against those fixed assumptions on later, held-out years.

Definitions (one basket at a time; supplier totals are summed over ALL importers):
  Y[s, t]   supplier s's world exports in year t. Measured in tonnes when s reports tonnes in both t and t+1
            (prices inflate dollar growth), otherwise in thousand USD. The basis is recorded per row.
  Event     (basket, s, t): s held >= min_share of the world market in t, its exports fell by >= drop from t to
            t+1, and world exports held up (>= world_floor x the year before) - so the fall is supplier-
            specific, not a collapse in demand.
  Target    for each alternative a among the largest exporters in t (excluding s): its growth
            g = Y[a, t+1] / Y[a, t] - 1, clipped to [-1, clip_max]. Capacity used by a scenario = max(0, q(g)).

This is observational: an alternative that grew after a rival's fall shows what DID happen, not what could
happen in a sudden, global shortfall. Everything here is pure (no I/O) so it can be tested on fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

QUANTILES = (0.1, 0.5, 0.9)
FEATURES = [
    "log_size",  # log of a's exports in t (in its basis units)
    "world_share",  # a's share of world exports in t (value)
    "rank",  # a's rank among exporters in t
    "growth_prev",  # a's growth t-1 -> t (NaN if not available)
    "growth_trend",  # a's mean growth over up to 3 prior years
    "growth_vol",  # std of a's yearly growth over up to 3 prior years
    "gap_share",  # the event's lost exports as a share of world exports in t (value)
    "shocked_share",  # the shocked supplier's world share in t
    "customer_overlap",  # share of s's customers (by value) that a already supplied in t
    "tonnes_basis",  # 1 if growth is measured in tonnes
]


@dataclass(frozen=True)
class EventRules:
    drop: float = 0.30
    min_share: float = 0.02
    world_floor: float = 0.80
    n_alternatives: int = 40
    clip_max: float = 3.0
    min_size_kusd: float = 1_000.0  # ignore alternatives exporting less than $1 m


DEFAULT_RULES = EventRules()


def supplier_totals(flows: pd.DataFrame) -> pd.DataFrame:
    """Per (basket, supplier, year): world exports by value and tonnes, tonnes coverage, and n customers.

    ``flows`` columns: basket_id, year, supplier_iso3, importer_iso3, value_kusd, quantity_t (NaN allowed).
    """
    g = flows.groupby(["basket_id", "supplier_iso3", "year"], as_index=False).agg(
        value_kusd=("value_kusd", "sum"),
        tonnes=("quantity_t", lambda q: q.sum(min_count=1)),
        tonnes_cov=("quantity_t", lambda q: float(q.notna().mean())),
    )
    world = g.groupby(["basket_id", "year"])["value_kusd"].transform("sum")
    g["world_share"] = g["value_kusd"] / world
    return g


def _growth(a: float, b: float) -> float:
    return b / a - 1 if a and a > 0 and b is not None and not np.isnan(b) else np.nan


def find_events(tot: pd.DataFrame, rules: EventRules = DEFAULT_RULES) -> pd.DataFrame:
    """Supplier-specific falls: one row per (basket, shocked supplier, year t)."""
    rows = []
    for (b, s), g in tot.groupby(["basket_id", "supplier_iso3"]):
        by = g.set_index("year")
        for t in by.index:
            if t + 1 not in by.index:
                continue
            r0, r1 = by.loc[t], by.loc[t + 1]
            if r0["world_share"] < rules.min_share:
                continue
            use_t = r0["tonnes"] > 0 and r1["tonnes"] > 0 and r0["tonnes_cov"] > 0.8 and r1["tonnes_cov"] > 0.8
            y0, y1 = (r0["tonnes"], r1["tonnes"]) if use_t else (r0["value_kusd"], r1["value_kusd"])
            fall = 1 - y1 / y0
            if fall < rules.drop:
                continue
            rows.append({"basket_id": b, "supplier_iso3": s, "year": int(t), "fall": fall, "tonnes_basis": int(use_t),
                         "shocked_share": r0["world_share"], "lost_kusd": r0["value_kusd"] - r1["value_kusd"]})  # fmt: skip
    ev = pd.DataFrame(
        rows, columns=["basket_id", "supplier_iso3", "year", "fall", "tonnes_basis", "shocked_share", "lost_kusd"]
    )
    if ev.empty:
        return ev
    world = tot.groupby(["basket_id", "year"])["value_kusd"].sum()
    w0 = ev.apply(lambda r: world.get((r.basket_id, r.year), np.nan), axis=1)
    w1 = ev.apply(lambda r: world.get((r.basket_id, r.year + 1), np.nan), axis=1)
    ev["gap_share"] = ev["lost_kusd"].clip(lower=0) / w0
    ev = ev[w1 >= rules.world_floor * w0].reset_index(drop=True)
    return ev


def _history(by: pd.DataFrame, t: int, use_t: bool) -> tuple[float, float, float]:
    """a's growth t-1->t, mean and std of yearly growth over up to 3 prior years (same basis)."""
    col = "tonnes" if use_t else "value_kusd"
    gs = [_growth(by[col].get(y - 1, np.nan), by[col].get(y, np.nan)) for y in (t - 2, t - 1, t)]
    gs = [g for g in gs if not np.isnan(g)]
    prev = _growth(by[col].get(t - 1, np.nan), by[col].get(t, np.nan))
    return prev, (float(np.mean(gs)) if gs else np.nan), (float(np.std(gs)) if len(gs) > 1 else np.nan)


def alternative_features(
    flows: pd.DataFrame, tot: pd.DataFrame, basket: str, shocked: str, year: int, gap_share: float,
    shocked_share: float, rules: EventRules = DEFAULT_RULES, with_target: bool = True,
) -> pd.DataFrame:  # fmt: skip
    """Feature rows for the alternatives to ``shocked`` in (basket, year); target growth if t+1 is known."""
    tb = tot[tot["basket_id"] == basket]
    now = tb[(tb["year"] == year) & (tb["supplier_iso3"] != shocked) & (tb["value_kusd"] >= rules.min_size_kusd)]
    now = now.sort_values("value_kusd", ascending=False).head(rules.n_alternatives).reset_index(drop=True)
    fb = flows[(flows["basket_id"] == basket) & (flows["year"] == year)]
    cust = fb[fb["supplier_iso3"] == shocked].set_index("importer_iso3")["value_kusd"]
    cust_total = cust.sum()
    rows = []
    for rank, r in enumerate(now.itertuples(), start=1):
        a = r.supplier_iso3
        by = tb[tb["supplier_iso3"] == a].set_index("year")
        nxt = by.loc[year + 1] if (year + 1) in by.index else None
        use_t = bool(
            r.tonnes > 0 and r.tonnes_cov > 0.8
            and (nxt is None or (nxt["tonnes"] > 0 and nxt["tonnes_cov"] > 0.8))
        )  # fmt: skip
        prev, trend, vol = _history(by, year, use_t)
        served = fb[(fb["supplier_iso3"] == a) & fb["importer_iso3"].isin(cust.index)]["importer_iso3"]
        overlap = float(cust[cust.index.isin(served)].sum() / cust_total) if cust_total > 0 else 0.0
        row = {
            "basket_id": basket, "shocked_iso3": shocked, "year": year, "alternative_iso3": a,
            "value_kusd": r.value_kusd, "log_size": float(np.log1p(r.tonnes if use_t else r.value_kusd)),
            "world_share": r.world_share, "rank": rank, "growth_prev": prev, "growth_trend": trend,
            "growth_vol": vol, "gap_share": gap_share, "shocked_share": shocked_share,
            "customer_overlap": overlap, "tonnes_basis": int(use_t),
        }  # fmt: skip
        if with_target:
            if nxt is None:
                continue
            g = _growth(r.tonnes if use_t else r.value_kusd, nxt["tonnes"] if use_t else nxt["value_kusd"])
            row["growth"] = float(np.clip(g, -1.0, rules.clip_max)) if not np.isnan(g) else np.nan
        rows.append(row)
    df = pd.DataFrame(rows)
    return df.dropna(subset=["growth"]) if with_target and not df.empty else df


def training_table(flows: pd.DataFrame, rules: EventRules = DEFAULT_RULES) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(events, alternative rows with targets) over the whole history."""
    tot = supplier_totals(flows)
    ev = find_events(tot, rules)
    parts = [
        alternative_features(flows, tot, e.basket_id, e.supplier_iso3, e.year, e.gap_share, e.shocked_share, rules)
        for e in ev.itertuples()
    ]
    alts = pd.concat([p for p in parts if not p.empty], ignore_index=True) if parts else pd.DataFrame()
    return ev, alts


@dataclass
class QuantileModel:
    """Gradient boosting for next-year growth: three quantiles (q10/q50/q90) plus the expected POSITIVE growth
    E[max(0, g)], which is what a scenario's capacity needs (the alternatives' total expansion). The q10-q90 band
    can be widened by a factor ``k`` calibrated on held-back years (split-conformal style)."""

    models: dict[float, HistGradientBoostingRegressor] = field(default_factory=dict)
    mean_pos: HistGradientBoostingRegressor | None = None
    k: float = 1.0

    @staticmethod
    def _gb(**kw) -> HistGradientBoostingRegressor:
        return HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=50,
                                             l2_regularization=1.0, random_state=kw.pop("seed", 0), **kw)  # fmt: skip

    def fit(self, X: pd.DataFrame, y: np.ndarray, weight: np.ndarray | None = None, seed: int = 0) -> QuantileModel:
        for q in QUANTILES:
            self.models[q] = self._gb(loss="quantile", quantile=q, seed=seed).fit(X[FEATURES], y, sample_weight=weight)
        self.mean_pos = self._gb(loss="squared_error", seed=seed).fit(
            X[FEATURES], np.maximum(y, 0), sample_weight=weight
        )
        return self

    def calibrate(self, X: pd.DataFrame, y: np.ndarray, weight: np.ndarray | None = None, target: float = 0.8) -> float:
        """Smallest widening factor k (>= 1) so the q10-q90 band covers ``target`` of (X, y)."""
        p = self.predict(X, raw=True)
        lo, mid, hi = p["q10"].to_numpy(), p["q50"].to_numpy(), p["q90"].to_numpy()
        w = np.ones(len(y)) if weight is None else weight
        for k in np.arange(1.0, 6.01, 0.05):
            cover = np.average((y >= mid - k * (mid - lo)) & (y <= mid + k * (hi - mid)), weights=w)
            if cover >= target:
                self.k = float(k)
                return self.k
        self.k = 6.0
        return self.k

    def predict(self, X: pd.DataFrame, raw: bool = False) -> pd.DataFrame:
        p = pd.DataFrame({f"q{int(q * 100)}": self.models[q].predict(X[FEATURES]) for q in QUANTILES}, index=X.index)
        p[:] = np.sort(p.to_numpy(), axis=1)  # non-crossing quantiles
        if not raw and self.k != 1.0:
            mid = p["q50"]
            p["q10"], p["q90"] = mid - self.k * (mid - p["q10"]), mid + self.k * (p["q90"] - mid)
        p["mean_pos"] = np.maximum(self.mean_pos.predict(X[FEATURES]), 0) if self.mean_pos is not None else np.nan
        return p


def pinball(y: np.ndarray, pred: np.ndarray, q: float, w: np.ndarray | None = None) -> float:
    d = y - pred
    loss = np.maximum(q * d, (q - 1) * d)
    return float(np.average(loss, weights=w))


def weights(df: pd.DataFrame) -> np.ndarray:
    """Weight rows by the alternative's size (sqrt of value) so tiny exporters don't dominate."""
    return np.sqrt(df["value_kusd"].clip(lower=1.0)).to_numpy()


def fit_calibrated(train: pd.DataFrame, seed: int = 0, calib_years: int = 2) -> QuantileModel:
    """Fit on all but the last ``calib_years`` of ``train``, calibrate the band on those, then refit on all of it
    keeping the calibrated k."""
    last = int((train["year"] + 1).max())
    fit_part = train[train["year"] + 1 <= last - calib_years]
    cal_part = train[train["year"] + 1 > last - calib_years]
    k = 1.0
    if len(fit_part) >= 50 and len(cal_part) >= 20:
        m0 = QuantileModel().fit(fit_part, fit_part["growth"].to_numpy(), weights(fit_part), seed)
        k = m0.calibrate(cal_part, cal_part["growth"].to_numpy(), weights(cal_part))
    m = QuantileModel().fit(train, train["growth"].to_numpy(), weights(train), seed)
    m.k = k
    return m


def evaluate(model: QuantileModel, test: pd.DataFrame) -> dict:
    """Held-out comparison of the learned model with the Scenario Studio's fixed assumptions.

    Fixed assumptions: every alternative expands by alpha = 5% / 15% / 30%. Also each alternative's own recent trend.
    Metrics (size-weighted): MAE of the median growth; and the AGGREGATE error - per event, predicted vs realised
    total expansion of the alternatives (positive growth only) as a share of their combined exports, which is the
    quantity a scenario uses. The learned aggregate uses the expected positive growth E[max(0, g)].
    """
    p = model.predict(test)
    y, w = test["growth"].to_numpy(), weights(test)

    def agg_error(pos_growth: np.ndarray) -> float:
        d = test.assign(pred=np.maximum(pos_growth, 0) * test["value_kusd"], real=np.maximum(y, 0) * test["value_kusd"])
        e = d.groupby(["basket_id", "shocked_iso3", "year"]).agg(
            pred=("pred", "sum"), real=("real", "sum"), base=("value_kusd", "sum")
        )
        return float(np.average((e["pred"] - e["real"]).abs() / e["base"], weights=np.sqrt(e["base"])))

    median = {"learned": p["q50"].to_numpy(), "fixed_5pct": np.full(len(y), 0.05), "fixed_15pct": np.full(len(y), 0.15),
              "fixed_30pct": np.full(len(y), 0.30), "own_trend": test["growth_trend"].fillna(0).clip(-1, 3).to_numpy()}  # fmt: skip
    pos = {**median, "learned": p["mean_pos"].to_numpy()}
    rows = {
        k: {"mae_median": float(np.average(np.abs(y - median[k]), weights=w)), "aggregate_error": agg_error(pos[k])}
        for k in median
    }
    return {
        "n": int(len(test)),
        "n_events": int(test.groupby(["basket_id", "shocked_iso3", "year"]).ngroups),
        "pinball": {f"q{int(q * 100)}": pinball(y, p[f"q{int(q * 100)}"].to_numpy(), q, w) for q in QUANTILES},
        "coverage_q10_q90": float(np.average((y >= p["q10"]) & (y <= p["q90"]), weights=w)),
        "models": rows,
        "realised_growth_median": float(np.median(y)),
        "realised_positive_share": float(np.average(y > 0, weights=w)),
    }


# ---------------------------------------------------------------------------------------------------------------
# All-products training table in DuckDB (same rules as the pandas functions above, vectorised).
# Substitution behaviour is learned across every HS6 product in BACI, not only the ~10 baskets, so the model has
# thousands of falls to learn from. `flows` must be a DuckDB relation/table with columns
# (year, p, e, i, v, q): product, exporter, importer, value (k USD), tonnes (NULL allowed).
# ---------------------------------------------------------------------------------------------------------------


def training_table_sql(
    con, flows: str, rules: EventRules = DEFAULT_RULES, min_world_kusd: float = 0.0
) -> tuple[pd.DataFrame, pd.DataFrame]:
    r = rules
    con.execute(f"""
    CREATE OR REPLACE TEMP TABLE _tot AS
      SELECT p, e, year, sum(v) AS v, sum(q) AS q, avg(CASE WHEN q IS NOT NULL THEN 1.0 ELSE 0.0 END) AS cov
      FROM {flows} GROUP BY ALL;
    CREATE OR REPLACE TEMP TABLE _w AS SELECT p, year, sum(v) AS wv FROM _tot GROUP BY ALL;
    CREATE OR REPLACE TEMP TABLE _t AS SELECT t.*, t.v / w.wv AS share, w.wv FROM _tot t JOIN _w w USING (p, year);
    CREATE OR REPLACE TEMP TABLE _ev AS
      SELECT a.p, a.e AS s, a.year AS t,
             (a.q > 0 AND b.q > 0 AND a.cov > 0.8 AND b.cov > 0.8) AS use_t,
             CASE WHEN (a.q > 0 AND b.q > 0 AND a.cov > 0.8 AND b.cov > 0.8) THEN 1 - b.q / a.q ELSE 1 - b.v / a.v END AS fall,
             a.share AS shocked_share, a.v - b.v AS lost_kusd, a.wv AS wv0, w1.wv AS wv1
      FROM _t a JOIN _t b ON b.p = a.p AND b.e = a.e AND b.year = a.year + 1
      JOIN _w w1 ON w1.p = a.p AND w1.year = a.year + 1
      WHERE a.share >= {r.min_share} AND a.wv >= {min_world_kusd};
    DELETE FROM _ev WHERE fall < {r.drop} OR wv1 < {r.world_floor} * wv0;
    CREATE OR REPLACE TEMP TABLE _al AS
      SELECT * FROM (
        SELECT ev.p, ev.s, ev.t, ev.shocked_share, greatest(ev.lost_kusd, 0) / ev.wv0 AS gap_share,
               x.e AS a, x.v, x.q, x.cov, x.share,
               row_number() OVER (PARTITION BY ev.p, ev.s, ev.t ORDER BY x.v DESC) AS rank
        FROM _ev ev JOIN _t x ON x.p = ev.p AND x.year = ev.t AND x.e <> ev.s AND x.v >= {r.min_size_kusd})
      WHERE rank <= {r.n_alternatives};
    CREATE OR REPLACE TEMP TABLE _sf AS
      SELECT ev.p, ev.s, ev.t, f.i, f.v FROM _ev ev JOIN {flows} f ON f.p = ev.p AND f.year = ev.t AND f.e = ev.s;
    CREATE OR REPLACE TEMP TABLE _ov AS
      SELECT al.p, al.s, al.t, al.a, sum(sf.v) AS shared
      FROM _al al JOIN _sf sf ON sf.p = al.p AND sf.s = al.s AND sf.t = al.t
      JOIN {flows} f ON f.p = al.p AND f.year = al.t AND f.e = al.a AND f.i = sf.i AND f.v > 0
      GROUP BY ALL;
    """)
    alts = con.execute(f"""
      WITH st AS (SELECT p, s, t, sum(v) AS tot FROM _sf GROUP BY ALL),
      j AS (
        SELECT al.*, n.v AS v1, n.q AS q1, n.cov AS cov1,
               h1.v AS hv1, h1.q AS hq1, h2.v AS hv2, h2.q AS hq2, h3.v AS hv3, h3.q AS hq3,
               (al.q > 0 AND al.cov > 0.8 AND n.q > 0 AND n.cov > 0.8) AS use_t,
               coalesce(ov.shared, 0) / nullif(st.tot, 0) AS customer_overlap
        FROM _al al
        JOIN _t n ON n.p = al.p AND n.e = al.a AND n.year = al.t + 1
        LEFT JOIN _t h1 ON h1.p = al.p AND h1.e = al.a AND h1.year = al.t - 1
        LEFT JOIN _t h2 ON h2.p = al.p AND h2.e = al.a AND h2.year = al.t - 2
        LEFT JOIN _t h3 ON h3.p = al.p AND h3.e = al.a AND h3.year = al.t - 3
        LEFT JOIN _ov ov ON ov.p = al.p AND ov.s = al.s AND ov.t = al.t AND ov.a = al.a
        LEFT JOIN st ON st.p = al.p AND st.s = al.s AND st.t = al.t),
      b AS (
        SELECT *,
          CASE WHEN use_t THEN q ELSE v END AS y0, CASE WHEN use_t THEN q1 ELSE v1 END AS y1,
          CASE WHEN use_t THEN hq1 ELSE hv1 END AS yh1, CASE WHEN use_t THEN hq2 ELSE hv2 END AS yh2,
          CASE WHEN use_t THEN hq3 ELSE hv3 END AS yh3
        FROM j),
      g AS (
        SELECT *,
          CASE WHEN yh1 > 0 AND y0 IS NOT NULL THEN y0 / yh1 - 1 END AS g0,
          CASE WHEN yh2 > 0 AND yh1 IS NOT NULL THEN yh1 / yh2 - 1 END AS g1,
          CASE WHEN yh3 > 0 AND yh2 IS NOT NULL THEN yh2 / yh3 - 1 END AS g2
        FROM b)
      SELECT p AS basket_id, s AS shocked_iso3, t AS year, a AS alternative_iso3, v AS value_kusd,
             ln(1 + y0) AS log_size, share AS world_share, rank, g0 AS growth_prev,
             list_avg(list_filter([g2, g1, g0], lambda x: x IS NOT NULL)) AS growth_trend,
             CASE WHEN len(list_filter([g2, g1, g0], lambda x: x IS NOT NULL)) > 1
                  THEN list_stddev_pop(list_filter([g2, g1, g0], lambda x: x IS NOT NULL)) END AS growth_vol,
             gap_share, shocked_share, coalesce(customer_overlap, 0) AS customer_overlap,
             use_t::INT AS tonnes_basis,
             least(greatest(y1 / y0 - 1, -1.0), {r.clip_max}) AS growth
      FROM g WHERE y0 > 0 AND y1 IS NOT NULL
    """).df()
    events = con.execute(
        "SELECT p AS basket_id, s AS supplier_iso3, t AS year, fall, use_t::INT AS tonnes_basis, shocked_share, lost_kusd, greatest(lost_kusd, 0) / wv0 AS gap_share FROM _ev"
    ).df()
    return events, alts


# ---------------------------------------------------------------------------------------------------------------
# Uncertainty for scenarios: sample each alternative's growth from its learned quantiles, with a shared
# per-event factor (alternatives in the same market tend to move together).
# ---------------------------------------------------------------------------------------------------------------

_QS = np.array(QUANTILES)


def pit(y: np.ndarray, q: np.ndarray) -> np.ndarray:
    """Probability integral transform of y under a piecewise-linear distribution through (q10, q50, q90),
    extended linearly to the tails and clipped to (0.005, 0.995). ``q`` has shape (n, 3)."""
    lo, mid, hi = q[:, 0], q[:, 1], q[:, 2]
    s_lo = np.maximum(mid - lo, 1e-6) / 0.4
    s_hi = np.maximum(hi - mid, 1e-6) / 0.4
    u = np.where(y <= mid, 0.5 - (mid - y) / s_lo, 0.5 + (y - mid) / s_hi)
    return np.clip(u, 0.005, 0.995)


def inverse(u: np.ndarray, q: np.ndarray, lo_clip: float = -1.0, hi_clip: float = 3.0) -> np.ndarray:
    """Inverse of ``pit``: growth at probability u (broadcasts u of shape (draws, n) against q (n, 3))."""
    lo, mid, hi = q[:, 0], q[:, 1], q[:, 2]
    s_lo = np.maximum(mid - lo, 1e-6) / 0.4
    s_hi = np.maximum(hi - mid, 1e-6) / 0.4
    g = np.where(u <= 0.5, mid - (0.5 - u) * s_lo, mid + (u - 0.5) * s_hi)
    return np.clip(g, lo_clip, hi_clip)


def event_correlation(test: pd.DataFrame, pred: pd.DataFrame) -> float:
    """Share of the variance of normal scores that is common within an event (intra-class correlation)."""
    from scipy.stats import norm

    z = norm.ppf(pit(test["growth"].to_numpy(), pred[["q10", "q50", "q90"]].to_numpy()))
    d = pd.DataFrame({"z": z, "k": test.groupby(["basket_id", "shocked_iso3", "year"]).ngroup().to_numpy()})
    total = d["z"].var()
    between = d.groupby("k")["z"].transform("mean").var()
    return float(np.clip(between / total, 0.0, 0.95)) if total > 0 else 0.0


def sample_capacity(q: np.ndarray, rho: float, draws: int, seed: int = 0) -> np.ndarray:
    """(draws, n) positive growth samples for n alternatives with common-factor correlation rho."""
    from scipy.stats import norm

    rng = np.random.default_rng(seed)
    c = rng.standard_normal((draws, 1))
    e = rng.standard_normal((draws, q.shape[0]))
    u = norm.cdf(np.sqrt(rho) * c + np.sqrt(1 - rho) * e)
    return np.maximum(inverse(u, q), 0.0)
