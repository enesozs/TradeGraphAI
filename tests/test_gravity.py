"""Gravity panel construction and PPML recovery on synthetic data with known coefficients."""

import duckdb
import numpy as np
import pandas as pd
import pytest

from tradegraph.models.gravity import GravityError, estimate, load_panel


def synthetic() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    n, years = 30, [2020, 2021, 2022]
    rows = []
    size = rng.lognormal(0, 1, n)
    dist = rng.uniform(100, 10000, (n, n))
    dist = (dist + dist.T) / 2
    contig = (rng.random((n, n)) < 0.1).astype(int)
    contig = np.maximum(contig, contig.T)
    for t in years:
        for i in range(n):
            for j in range(n):
                if i == j:
                    continue
                mu = np.exp(np.log(size[i]) + np.log(size[j]) - 1.0 * np.log(dist[i, j]) + 0.5 * contig[i, j] + 8)
                rows.append(
                    {
                        "year": t,
                        "exporter": i,
                        "importer": j,
                        "value": float(rng.poisson(mu)),
                        "ldist": np.log(dist[i, j]),
                        "contig": contig[i, j],
                        "comlang": 0,
                        "colony": 0,
                        "rta": 0,
                        "exp_year": f"{i}_{t}",
                        "imp_year": f"{j}_{t}",
                        "pair_id": f"{min(i, j)}_{max(i, j)}",
                        "cov_missing": 0,
                        "no_cov": False,
                    }
                )
    return pd.DataFrame(rows)


def test_ppml_recovers_known_coefficients():
    df = synthetic()
    # comlang/colony/rta are constant 0 -> collinear; drop from formula by giving them variation-free columns
    # pyfixest drops collinear variables automatically.
    fit = estimate(df, "synthetic")
    assert fit.coefficients["ldist"]["estimate"] == pytest.approx(-1.0, abs=0.05)
    assert fit.coefficients["contig"]["estimate"] == pytest.approx(0.5, abs=0.1)
    assert len(fit.expected) == len(df)
    assert (fit.expected["expected"] >= 0).all()
    # PPML with exporter/importer FE preserves totals: sum of fitted == sum of observed
    assert fit.expected["expected"].sum() == pytest.approx(df["value"].sum(), rel=1e-6)


def test_panel_zero_fills_and_maps_taiwan():
    con = duckdb.connect()
    con.execute("""
        CREATE TABLE flows(year INT, exporter INT, importer INT, product_code VARCHAR, value_kusd DOUBLE, quantity_t DOUBLE);
        INSERT INTO flows VALUES (2020, 490, 842, '111111', 5, 1), (2020, 842, 156, '999999', 7, 1);
        CREATE TABLE basket_codes AS SELECT 'b' AS basket_id, '111111' AS product_code;
        CREATE TABLE dim_country AS SELECT * FROM (VALUES (490, 'S19'), (842, 'USA'), (156, 'CHN'), (697, 'R20'))
            t(country_code, iso3);
        CREATE TABLE universe AS SELECT * FROM (VALUES (2020, 490), (2020, 842), (2020, 156), (2020, 697))
            t(year, country_code);
        CREATE TABLE gpairs AS SELECT * FROM (VALUES
            ('TWN','USA',11000.0,0,0,0,0), ('USA','TWN',11000.0,0,0,0,0), ('TWN','CHN',800.0,0,1,0,0),
            ('CHN','TWN',800.0,0,1,0,0), ('USA','CHN',11000.0,0,0,0,0), ('CHN','USA',11000.0,0,0,0,0))
            t(iso3_o, iso3_d, dist_km, contig, comlang_off, colony, cov_missing);
        CREATE TABLE grta AS SELECT 'USA' AS iso3_o, 'CHN' AS iso3_d, 2020 AS year, 0 AS rta;
    """)
    p = load_panel(con, "b")
    assert len(p) == 4 * 3  # all ordered pairs of 4 countries
    assert p.loc[(p.exporter == 490) & (p.importer == 842), "value"].item() == 5  # Taiwan flow kept
    assert p.loc[(p.exporter == 842) & (p.importer == 156), "value"].item() == 0  # other product -> zero
    assert not p.loc[(p.exporter == 490) & (p.importer == 842), "no_cov"].item()  # S19 -> TWN covariates
    assert p.loc[(p.exporter == 697) | (p.importer == 697), "no_cov"].all()  # R20 has no covariates
    assert p.loc[(p.exporter == 842) & (p.importer == 490), "rta"].item() == 0  # missing RTA -> 0


def test_guard_fails_when_large_flows_lack_predictions():
    df = synthetic()
    big = df["value"].idxmax()
    df.loc[big, "contig"] = np.nan  # a missing covariate drops the largest positive flow from the model
    with pytest.raises(GravityError, match="no gravity prediction"):
        estimate(df, "synthetic")
