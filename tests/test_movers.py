"""Movers on a hand-built panel (windows 2012–2013 vs 2020–2021, threshold 50).

Importer 10, basket b:
  2012: X 100            -> HHI 1.0, top1 1.0, imports 100
  2013: X 50, Y 50       -> HHI 0.5, top1 0.5, imports 100
  2020: X 90, Y 10       -> HHI 0.82, top1 0.9, imports 100
  2021: X 100            -> HHI 1.0, top1 1.0, imports 100
  start avg HHI 0.75, end avg 0.91 -> delta 0.16
  Y share: start (0 + 0.5)/2 = 0.25; end (0.1 + 0)/2 = 0.05 -> delta -0.20; present 1 and 1 years
Importer 20 has no 2013 data -> excluded (incomplete window).
Importer 30 imports only 10/yr -> excluded (below threshold).
"""

import duckdb
import pytest

from tradegraph.metrics import dependency, movers


@pytest.fixture()
def con():
    c = duckdb.connect()
    c.execute("""
        CREATE TABLE flows(year INT, exporter INT, importer INT, product_code VARCHAR,
                           value_kusd DOUBLE, quantity_t DOUBLE);
        INSERT INTO flows VALUES
          (2012, 1, 10, '111111', 100, 1),
          (2013, 1, 10, '111111', 50, 1), (2013, 2, 10, '111111', 50, 1),
          (2020, 1, 10, '111111', 90, 1), (2020, 2, 10, '111111', 10, 1),
          (2021, 1, 10, '111111', 100, 1),
          (2012, 1, 20, '111111', 100, 1), (2020, 1, 20, '111111', 100, 1), (2021, 1, 20, '111111', 100, 1),
          (2012, 1, 30, '111111', 10, 1), (2013, 1, 30, '111111', 10, 1),
          (2020, 1, 30, '111111', 10, 1), (2021, 1, 30, '111111', 10, 1);
        CREATE TABLE basket_codes(basket_id VARCHAR, product_code VARCHAR);
        INSERT INTO basket_codes VALUES ('b', '111111');
    """)
    dependency.build(c)
    movers.build(c, (2012, 2013), (2020, 2021), 50)
    return c


def test_only_complete_and_material_importers_kept(con):
    assert [r[0] for r in con.execute("SELECT importer FROM movers_importer").fetchall()] == [10]


def test_importer_deltas(con):
    start, end, delta, t0, t1 = con.execute(
        "SELECT start_hhi, end_hhi, delta_hhi, start_top1_share, end_top1_share FROM movers_importer"
    ).fetchone()
    assert start == pytest.approx(0.75)
    assert end == pytest.approx(0.91)
    assert delta == pytest.approx(0.16)
    assert (t0, t1) == (pytest.approx(0.75), pytest.approx(0.95))


def test_supplier_share_deltas(con):
    rows = {
        r[0]: r[1:]
        for r in con.execute(
            "SELECT supplier, start_share, end_share, delta_share, years_present_start, years_present_end "
            "FROM movers_supplier WHERE importer = 10"
        ).fetchall()
    }
    assert rows[2][:3] == (pytest.approx(0.25), pytest.approx(0.05), pytest.approx(-0.20))
    assert rows[2][3:] == (1, 1)
    assert rows[1][:3] == (pytest.approx(0.75), pytest.approx(0.95), pytest.approx(0.20))


def test_supplier_shares_sum_to_one_per_window(con):
    s, e = con.execute("SELECT sum(start_share), sum(end_share) FROM movers_supplier WHERE importer = 10").fetchone()
    assert s == pytest.approx(1.0) and e == pytest.approx(1.0)
