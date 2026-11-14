"""ML B: nowcast EU imports per basket and supplier on the BACI basis, for years BACI has not reached yet.

BACI (annual, USD, FOB-reconciled from both partners' declarations) runs about two years behind. Eurostat Comext
(monthly, EUR, the importer's own CIF declarations) is current to within two months. This module learns the
bridge between the two on years where both exist, then estimates BACI-basis values for the latest years.

Scope (owner decision, 2026-11-11): EU only - the EU as a bloc (imports from outside the EU) and six member
states. Nothing here is extrapolated to non-EU importers.

Per (reporter, partner, basket, year):
  1. Comext value converted to USD month by month (monthly average rates), summed over the year. For an
     incomplete year (e.g. January-August) it is scaled up by the reporter-basket's median share of a year
     falling in those months, from complete earlier years.
  2. Bridge ratio r = BACI value / Comext USD value (FOB vs CIF, reporter vs reconciled declarations, coverage).
     log r is predicted by gradient boosting from the last KNOWN ratios (only BACI years <= year - lag, where lag
     is how far BACI lags behind: 1 for the first missing year, 2 for the next) and size.
     Baselines: r = 1 ("Comext at the exchange rate") and r = last known r.
Pure functions only (no I/O), tested on fixtures.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

KEYS = ["reporter", "partner_iso3", "basket_id"]
FEATURES = ["log_comext_usd", "last_log_ratio", "mean_log_ratio", "lag", "partial", "reporter_code", "basket_code"]
METHODS = ("fx_only", "last_ratio", "learned")


def seasonal_share(monthly: pd.DataFrame, months: int, before_year: int | None = None) -> pd.DataFrame:
    """Median share of a complete year's USD value falling in its first ``months`` months, per (reporter, basket).

    ``monthly`` columns: reporter, basket_id, year, month (1-12), value_usd. Only complete years (and, if given,
    years before ``before_year``) are used.
    """
    m = monthly if before_year is None else monthly[monthly["year"] < before_year]
    agg = m.groupby(["reporter", "basket_id", "year"]).agg(n=("month", "nunique"), tot=("value_usd", "sum"))
    part = m[m["month"] <= months].groupby(["reporter", "basket_id", "year"])["value_usd"].sum()
    agg = agg[agg["n"] == 12].join(part.rename("part"))
    share = (agg["part"] / agg["tot"]).dropna()
    return share.groupby(["reporter", "basket_id"]).median().rename("share").reset_index()


def annual(monthly: pd.DataFrame, upto_month: int | None = None) -> pd.DataFrame:
    """Annual Comext USD value per (reporter, partner, basket, year), optionally only months <= ``upto_month``."""
    m = monthly if upto_month is None else monthly[monthly["month"] <= upto_month]
    return m.groupby([*KEYS, "year"], as_index=False).agg(value_usd=("value_usd", "sum"), months=("month", "nunique"))


def features(comext: pd.DataFrame, baci: pd.DataFrame, lag: int, partial: bool = False) -> pd.DataFrame:
    """Rows for every (reporter, partner, basket, year) in ``comext`` with history from BACI years <= year - lag.

    ``comext``: KEYS + year, comext_kusd. ``baci``: KEYS + year, value_kusd (all known years; the target column
    ``value_kusd`` is attached for evaluation, while the features only see years <= year - lag).
    """
    d = comext.merge(baci[[*KEYS, "year", "value_kusd"]], on=[*KEYS, "year"], how="left")
    hist = comext.merge(baci[[*KEYS, "year", "value_kusd"]], on=[*KEYS, "year"])
    hist["lr"] = np.log(hist["value_kusd"] / hist["comext_kusd"])
    hist = hist[np.isfinite(hist["lr"])][[*KEYS, "year", "lr"]].rename(columns={"year": "hy"})
    j = d[[*KEYS, "year"]].merge(hist, on=KEYS, how="left")
    j = j[j["hy"] <= j["year"] - lag].sort_values("hy")
    g = j.groupby([*KEYS, "year"])
    h = pd.DataFrame({"last_log_ratio": g["lr"].last(), "last_year": g["hy"].last(),
                      "mean_log_ratio": g["lr"].apply(lambda s: s.tail(3).mean())}).reset_index()  # fmt: skip
    d = d.merge(h, on=[*KEYS, "year"], how="left")
    d["lag"] = (d["year"] - d["last_year"]).astype(float)
    d["log_ratio"] = np.log(d["value_kusd"] / d["comext_kusd"])
    d["log_comext_usd"] = np.log1p(d["comext_kusd"])
    d["partial"] = int(partial)
    return d.drop(columns=["last_year"])


def encode(d: pd.DataFrame, reporters: list[str], baskets: list[str]) -> pd.DataFrame:
    d = d.copy()
    d["reporter_code"] = pd.Categorical(d["reporter"], categories=reporters).codes
    d["basket_code"] = pd.Categorical(d["basket_id"], categories=baskets).codes
    return d


def fit(train: pd.DataFrame, seed: int = 0) -> HistGradientBoostingRegressor:
    t = train[np.isfinite(train["log_ratio"])]
    w = np.sqrt(t["comext_kusd"].clip(lower=1.0))
    m = HistGradientBoostingRegressor(loss="absolute_error", max_iter=300, learning_rate=0.05, max_leaf_nodes=15,
                                      min_samples_leaf=40, categorical_features=[5, 6], random_state=seed)  # fmt: skip
    return m.fit(t[FEATURES], t["log_ratio"].clip(-3, 3), sample_weight=w)


def predict(model: HistGradientBoostingRegressor | None, rows: pd.DataFrame, method: str = "learned") -> np.ndarray:
    """BACI-basis value (k USD) for each row: Comext USD x exp(predicted log ratio)."""
    if method == "fx_only":
        lr = np.zeros(len(rows))
    elif method == "last_ratio":
        lr = rows["last_log_ratio"].fillna(0).to_numpy()
    else:
        lr = model.predict(rows[FEATURES])
    return rows["comext_kusd"].to_numpy() * np.exp(lr)


def totals_error(rows: pd.DataFrame, pred: np.ndarray, baci_totals: pd.DataFrame) -> pd.DataFrame:
    """Per (reporter, basket, year): predicted total vs the BACI total over ALL partners (pairs missing from
    Comext count against the nowcast)."""
    g = rows.assign(pred=pred).groupby(["reporter", "basket_id", "year"], as_index=False)["pred"].sum()
    g = g.merge(baci_totals, on=["reporter", "basket_id", "year"])
    g["log_error"] = np.log(g["pred"] / g["real"])
    return g


def top_share_error(rows: pd.DataFrame, pred: np.ndarray, baci: pd.DataFrame) -> pd.DataFrame:
    """Per (reporter, basket, year): nowcast share of BACI's largest supplier vs its BACI share (percentage points)."""
    d = rows.assign(pred=pred)
    d["pshare"] = d["pred"] / d.groupby(["reporter", "basket_id", "year"])["pred"].transform("sum")
    b = baci.copy()
    b["share"] = b["value_kusd"] / b.groupby(["reporter", "basket_id", "year"])["value_kusd"].transform("sum")
    top = b.sort_values("share").groupby(["reporter", "basket_id", "year"]).tail(1)
    m = top.merge(d[[*KEYS, "year", "pshare"]], on=[*KEYS, "year"], how="left").fillna({"pshare": 0.0})
    m["pp_error"] = m["pshare"] - m["share"]
    return m
