"""ML A: event detection, features and targets on hand-built flows."""

import numpy as np
import pandas as pd
import pytest

from tradegraph.models.substitution import (
    EventRules,
    alternative_features,
    find_events,
    pinball,
    supplier_totals,
    training_table,
)


def flows_fixture() -> pd.DataFrame:
    """One basket, three exporters (S, A, B) selling to two importers (X, Y) over 2015-2018.

    S falls 50% from 2016 to 2017; A picks most of it up (tonnes reported), B is flat (no tonnes).
    World exports hold (S+A+B: 2016 = 200, 2017 = 190).
    """
    rows = []

    def add(y, s, i, v, q):  # noqa: E306
        rows.append(
            {"basket_id": "b", "year": y, "supplier_iso3": s, "importer_iso3": i, "value_kusd": v, "quantity_t": q}
        )

    for y, (sv, av, bv) in {2015: (100, 50, 40), 2016: (100, 55, 45), 2017: (50, 95, 45), 2018: (60, 90, 46)}.items():
        add(y, "S", "X", sv * 0.6, sv * 0.6)
        add(y, "S", "Y", sv * 0.4, sv * 0.4)
        add(y, "A", "X", av, av)  # A already supplies X, not Y
        add(y, "B", "Y", bv, np.nan)  # B reports no tonnes
    return pd.DataFrame(rows)


def test_totals_and_shares():
    tot = supplier_totals(flows_fixture())
    r = tot[(tot.supplier_iso3 == "S") & (tot.year == 2016)].iloc[0]
    assert r.value_kusd == pytest.approx(100) and r.tonnes == pytest.approx(100)
    assert r.world_share == pytest.approx(100 / 200)
    b = tot[(tot.supplier_iso3 == "B") & (tot.year == 2016)].iloc[0]
    assert np.isnan(b.tonnes) and b.tonnes_cov == 0.0


def test_event_found_only_for_the_fall():
    ev = find_events(supplier_totals(flows_fixture()), EventRules(min_size_kusd=1))
    assert list(zip(ev.supplier_iso3, ev.year, strict=True)) == [("S", 2016)]
    e = ev.iloc[0]
    assert e.fall == pytest.approx(0.5) and e.tonnes_basis == 1
    assert e.gap_share == pytest.approx(50 / 200)


def test_no_event_when_world_demand_collapses():
    f = flows_fixture()
    f.loc[f.year == 2017, "value_kusd"] *= 0.3  # everyone falls: not supplier-specific
    f.loc[f.year == 2017, "quantity_t"] *= 0.3
    assert find_events(supplier_totals(f), EventRules(min_size_kusd=1)).empty


def test_alternative_targets_and_overlap():
    f = flows_fixture()
    tot = supplier_totals(f)
    alts = alternative_features(
        f, tot, "b", "S", 2016, gap_share=0.25, shocked_share=0.5, rules=EventRules(min_size_kusd=1)
    )
    a = alts.set_index("alternative_iso3")
    assert a.loc["A", "growth"] == pytest.approx(95 / 55 - 1)  # tonnes basis
    assert a.loc["A", "tonnes_basis"] == 1
    assert a.loc["B", "growth"] == pytest.approx(0.0)  # value basis (no tonnes)
    assert a.loc["B", "tonnes_basis"] == 0
    assert a.loc["A", "customer_overlap"] == pytest.approx(0.6)  # S's customer X is 60% of S's sales
    assert a.loc["B", "customer_overlap"] == pytest.approx(0.4)
    assert a.loc["A", "growth_prev"] == pytest.approx(55 / 50 - 1)
    assert a.loc["A", "rank"] == 1


def test_training_table_end_to_end():
    ev, alts = training_table(flows_fixture(), EventRules(min_size_kusd=1))
    assert len(ev) == 1 and set(alts.alternative_iso3) == {"A", "B"}


def test_pinball_is_asymmetric():
    y = np.array([1.0])
    assert pinball(y, np.array([0.0]), 0.9) == pytest.approx(0.9)
    assert pinball(y, np.array([2.0]), 0.9) == pytest.approx(0.1)


def test_sql_matches_pandas():
    import duckdb

    from tradegraph.models.substitution import training_table_sql

    f = flows_fixture()
    rules = EventRules(min_size_kusd=1)
    ev_pd, al_pd = training_table(f, rules)
    con = duckdb.connect()
    con.register(
        "fx",
        f.rename(
            columns={"basket_id": "p", "supplier_iso3": "e", "importer_iso3": "i", "value_kusd": "v", "quantity_t": "q"}
        ),
    )
    ev_sql, al_sql = training_table_sql(con, "fx", rules)
    assert len(ev_sql) == len(ev_pd) == 1
    assert ev_sql.iloc[0].fall == pytest.approx(ev_pd.iloc[0].fall)
    cols = [
        "growth",
        "log_size",
        "world_share",
        "rank",
        "growth_prev",
        "growth_trend",
        "customer_overlap",
        "tonnes_basis",
        "gap_share",
    ]
    a = al_pd.set_index("alternative_iso3").sort_index()[cols]
    b = al_sql.set_index("alternative_iso3").sort_index()[cols].astype(float)
    pd.testing.assert_frame_equal(a.astype(float), b, check_exact=False, rtol=1e-9)


def test_pit_and_inverse_round_trip():
    from tradegraph.models.substitution import inverse, pit, sample_capacity

    q = np.array([[-0.2, 0.1, 0.6], [0.0, 0.0, 0.5]])
    assert pit(np.array([0.1, 0.0]), q) == pytest.approx([0.5, 0.5])
    assert pit(np.array([0.6, 0.5]), q) == pytest.approx([0.9, 0.9])
    u = np.array([[0.1, 0.9], [0.3, 0.7]])
    g = inverse(u, q)
    assert g[0] == pytest.approx([-0.2, 0.5])
    s = sample_capacity(q, rho=0.5, draws=4000, seed=1)
    assert s.shape == (4000, 2) and (s >= 0).all()
    assert np.median(s[:, 0]) == pytest.approx(0.1, abs=0.03)
