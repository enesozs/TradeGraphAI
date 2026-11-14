"""Forecast: leakage, splits, baselines and metrics on small hand-built data."""

import duckdb
import numpy as np
import pandas as pd
import pytest

from tradegraph.forecast.benchmark import metrics, split
from tradegraph.forecast.features import build_features
from tradegraph.forecast.models import MODELS


def make_con(links: list[tuple]) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("CREATE TABLE links(basket_id VARCHAR, year INT, exporter INT, importer INT, value DOUBLE)")
    con.executemany("INSERT INTO links VALUES (?, ?, ?, ?, ?)", links)
    con.execute("""
        CREATE TABLE cov(exporter INT, importer INT, year INT, ldist DOUBLE, contig INT, comlang INT, colony INT,
                         cov_missing INT, rta INT);
        CREATE TABLE nodes(basket_id VARCHAR, year INT, country INT, centrality DOUBLE);
        CREATE TABLE grav(basket_id VARCHAR, year INT, exporter INT, importer INT, expected DOUBLE);
    """)
    return con


BASE = [
    ("b", 2018, 1, 9, 100.0), ("b", 2019, 1, 9, 110.0), ("b", 2020, 1, 9, 121.0), ("b", 2021, 1, 9, 130.0),
    ("b", 2019, 2, 9, 50.0), ("b", 2020, 2, 9, 40.0),  # link 2->9 disappears after 2020
    ("b", 2020, 3, 8, 10.0), ("b", 2021, 3, 8, 12.0),
]  # fmt: skip


def row(df, year, e, i):
    return df[(df.year == year) & (df.exporter == e) & (df.importer == i)].iloc[0]


def test_lags_shares_and_target():
    df = build_features(make_con(BASE))
    r = row(df, 2020, 1, 9)
    assert r.lv0 == pytest.approx(np.log1p(121))
    assert r.lv1 == pytest.approx(np.log1p(110)) and r.has1 == 1
    assert r.lv2 == pytest.approx(np.log1p(100)) and r.has2 == 1
    assert r.mean3 == pytest.approx(np.mean(np.log1p([121, 110, 100])))
    assert r.share == pytest.approx(121 / (121 + 40))
    assert r.hhi == pytest.approx((121**2 + 40**2) / (121 + 40) ** 2)
    assert r.value_next == 130
    assert np.isnan(row(df, 2020, 2, 9).value_next)  # not recorded next year -> NULL, not 0
    first = row(df, 2018, 1, 9)
    assert first.has1 == 0 and first.lv1 == 0 and first.growth == 0


def test_features_do_not_depend_on_the_future():
    """Changing anything in years > t must leave year-t features unchanged (target aside)."""
    keys = ["basket_id", "year", "exporter", "importer"]
    base = build_features(make_con(BASE))
    feats = [c for c in base.columns if c not in keys and c != "value_next"]
    future_changed = [(b, y, e, i, v * 7 if y >= 2021 else v) for b, y, e, i, v in BASE] + [("b", 2021, 5, 9, 999.0)]
    alt = build_features(make_con(future_changed))
    b20 = base[base.year == 2020].set_index(keys)[feats].sort_index()
    a20 = alt[alt.year == 2020].set_index(keys)[feats].sort_index()
    pd.testing.assert_frame_equal(b20, a20)
    # ...while the target does change, proving the perturbation reached year t+1
    assert not np.allclose(
        base[base.year == 2020].set_index(keys)["value_next"].fillna(-1).sort_index(),
        alt[alt.year == 2020].set_index(keys)["value_next"].fillna(-1).sort_index(),
    )


def test_split_is_chronological():
    df = build_features(make_con(BASE))
    train, test = split(df, target_year=2021)
    assert (train["year"] + 1 <= 2020).all()  # every training target is observed before the test year
    assert (test["year"] == 2020).all()
    assert test["value_next"].notna().all() and train["value_next"].notna().all()


def test_baselines():
    df = build_features(make_con(BASE))
    _, test = split(df, 2021)
    y = pd.Series(dtype=float)
    assert MODELS["persistence"](test, y, test, 0) == pytest.approx(test["lv0"].to_numpy())
    # gravity falls back to persistence when no gravity estimate exists
    assert MODELS["gravity"](test, y, test, 0) == pytest.approx(test["lv0"].to_numpy())


def test_metrics_hand_values():
    actual = np.array([np.expm1(1.0), np.expm1(3.0)])
    m = metrics(actual, np.array([2.0, 3.0]))
    assert m["mae_log"] == pytest.approx(0.5)
    assert m["rmse_log"] == pytest.approx(np.sqrt(0.5))
    assert m["bias_log"] == pytest.approx(0.5)
    assert m["wape_usd"] == pytest.approx((np.expm1(2.0) - np.expm1(1.0)) / actual.sum())


def test_delta_wrapper_adds_back_last_year():
    from tradegraph.forecast.models import _delta

    df = build_features(make_con(BASE))
    train, test = split(df, 2021)
    zero_change = _delta(lambda tr, y, te, s: np.zeros(len(te)))
    assert zero_change(train, np.log1p(train["value_next"]), test, 0) == pytest.approx(test["lv0"].to_numpy())


def test_value_weighting_runs_and_differs():
    rng = np.random.default_rng(1)
    n = 400
    df = pd.DataFrame(
        {
            c: rng.normal(size=n)
            for c in [
                "lv0",
                "lv1",
                "lv2",
                "mean3",
                "growth",
                "share",
                "hhi",
                "limp",
                "lexp",
                "exp_wshare",
                "ldist",
                "c_exp",
                "c_imp",
                "lgrav",
            ]
        }
    )
    df = df.assign(
        has1=1,
        has2=1,
        n_sup=5,
        contig=0,
        comlang=0,
        colony=0,
        cov_missing=0,
        rta=0,
        basket_id="b",
        value=np.exp(rng.normal(3, 2, n)),
    )
    y = df["lv0"] + rng.normal(scale=0.5, size=n) + (df["value"] > 100) * 1.0
    plain = MODELS["gbm_graph"](df, y, df, 0)
    weighted = MODELS["gbm_weighted"](df, y, df, 0)
    assert plain.shape == weighted.shape and not np.allclose(plain, weighted)
