"""ML B: annualisation, bridge features (no look-ahead), baselines and error metrics on hand-built data."""

import numpy as np
import pandas as pd
import pytest

from tradegraph.models.nowcast import annual, features, predict, seasonal_share, top_share_error, totals_error
from tradegraph.models.nowcast_build import common_cutoff

K = {"reporter": "DE", "partner_iso3": "CHN", "basket_id": "b"}


def monthly(years=(2020, 2021), partial=None) -> pd.DataFrame:
    rows = []
    for y in years:
        for m in range(1, 13 if y != partial else 9):
            rows.append({**K, "year": y, "month": m, "value_usd": 10.0 * (1 + (y - 2020))})  # flat months
    return pd.DataFrame(rows)


def test_seasonal_share_uses_complete_earlier_years_only():
    m = monthly(years=(2020, 2021, 2022), partial=2022)
    s = seasonal_share(m, 8)
    assert len(s) == 1 and s.iloc[0].share == pytest.approx(8 / 12)
    assert seasonal_share(m, 8, before_year=2020).empty


def test_annual_and_partial():
    m = monthly(years=(2020,))
    assert annual(m).iloc[0].value_usd == pytest.approx(120)
    p = annual(m, upto_month=8).iloc[0]
    assert p.value_usd == pytest.approx(80) and p.months == 8


def comext_baci():
    comext = pd.DataFrame({**K, "year": [2020, 2021, 2022, 2023], "comext_kusd": [100.0, 110.0, 120.0, 130.0]})
    baci = pd.DataFrame({**K, "year": [2020, 2021, 2022], "value_kusd": [75.0, 88.0, 90.0]})  # ratios .75 .8 .75
    return comext, baci


def test_features_respect_lag():
    comext, baci = comext_baci()
    d1 = features(comext, baci, lag=1).set_index("year")
    assert np.isnan(d1.loc[2020, "last_log_ratio"])
    assert d1.loc[2022, "last_log_ratio"] == pytest.approx(np.log(0.8)) and d1.loc[2022, "lag"] == 1
    assert d1.loc[2023, "last_log_ratio"] == pytest.approx(np.log(0.75))
    d2 = features(comext, baci, lag=2).set_index("year")
    # 2022 with lag 2 may only see 2020: the 2021 and 2022 ratios are not yet known
    assert d2.loc[2022, "last_log_ratio"] == pytest.approx(np.log(0.75)) and d2.loc[2022, "lag"] == 2
    assert d2.loc[2023, "mean_log_ratio"] == pytest.approx(np.mean([np.log(0.75), np.log(0.8)]))
    assert d2.loc[2021, "log_ratio"] == pytest.approx(np.log(0.8))  # target unaffected by the lag


def test_baselines_and_errors():
    comext, baci = comext_baci()
    d = features(comext, baci, lag=1)
    row = d[d.year == 2022]
    assert predict(None, row, "fx_only")[0] == pytest.approx(120.0)
    assert predict(None, row, "last_ratio")[0] == pytest.approx(120.0 * 0.8)
    # BACI total includes 10 from a partner absent in Comext: it counts against the nowcast
    tot = pd.DataFrame({"reporter": "DE", "basket_id": "b", "year": [2022], "real": [100.0]})
    e = totals_error(row, np.array([90.0]), tot)
    assert e.iloc[0].log_error == pytest.approx(np.log(0.9))
    b2 = pd.concat([baci, pd.DataFrame({**K, "partner_iso3": "USA", "year": [2022], "value_kusd": [10.0]})])
    s = top_share_error(row, np.array([90.0]), b2[b2.year == 2022])
    assert s.iloc[0].partner_iso3 == "CHN" and s.iloc[0].pp_error == pytest.approx(1.0 - 0.9)


def test_common_cutoff_holds_every_reporter_back_across_years():
    m = pd.DataFrame({"reporter": ["DE", "DE", "IT", "IT"], "year": [2027, 2027, 2026, 2026], "month": [1, 2, 11, 12]})
    # IT's newest published month is Dec 2026: everyone stops there, so 2026 is complete for both and IT keeps a row
    assert common_cutoff(m, ["DE", "IT"]) == (2026, 12)
    assert common_cutoff(m[m.reporter == "DE"], ["DE"]) == (2027, 2)
    with pytest.raises(ValueError, match="IT"):
        common_cutoff(m[m.reporter == "DE"], ["DE", "IT"])
