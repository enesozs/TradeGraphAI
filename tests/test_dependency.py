"""Hand-computed fixture tests for the dependency metrics.

Fixture (year 2023, values in k USD, quantities in tonnes):

  product 111111 (basket "b"):
    X -> A  60   (6 t)
    Y -> A  30   (no quantity recorded)
    Z -> A  10   (4 t)
    X -> B  40   (4 t)
  product 222222 (basket "b" as well):
    Y -> A  20   (2 t)
  product 999999 (not in any basket):
    Z -> A 500   (must be ignored)

Importer A, basket b: X=60, Y=30+20=50, Z=10 -> total 120
  shares: X 0.5, Y 5/12, Z 1/12
  HHI = 0.25 + 25/144 + 1/144 = 62/144
  top1 = X (0.5); top3 = 1.0; suppliers = 3
  redirectable: X exports 40 to B -> 40; Y and Z export nothing else -> 0
  tonnes: X 6, Y 2 (only the 222222 flow has q), Z 4 -> total 12
  tonnes coverage (value share of flows with q) = (60 + 20 + 10) / 120 = 0.75
"""

import duckdb
import pytest

from tradegraph.metrics.dependency import build, direct_exposure


@pytest.fixture()
def con():
    c = duckdb.connect()
    c.execute("""
        CREATE TABLE flows(year INT, exporter INT, importer INT, product_code VARCHAR,
                           value_kusd DOUBLE, quantity_t DOUBLE);
        INSERT INTO flows VALUES
          (2023, 1, 10, '111111', 60, 6), (2023, 2, 10, '111111', 30, NULL),
          (2023, 3, 10, '111111', 10, 4), (2023, 1, 20, '111111', 40, 4),
          (2023, 2, 10, '222222', 20, 2), (2023, 3, 10, '999999', 500, 50);
        CREATE TABLE basket_codes(basket_id VARCHAR, product_code VARCHAR);
        INSERT INTO basket_codes VALUES ('b', '111111'), ('b', '222222');
    """)
    build(c)
    return c


def row(con, sql):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    r = cur.fetchone()
    return dict(zip(cols, r, strict=True)) if r else None


def test_importer_metrics(con):
    m = row(con, "SELECT * FROM mart_importer WHERE importer = 10")
    assert m["imports_kusd"] == pytest.approx(120)  # 999999 excluded
    assert m["supplier_count"] == 3
    assert m["hhi_value"] == pytest.approx(62 / 144)
    assert m["effective_suppliers"] == pytest.approx(144 / 62)
    assert m["top1_supplier"] == 1
    assert m["top1_share_value"] == pytest.approx(0.5)
    assert m["top3_share_value"] == pytest.approx(1.0)
    assert m["imports_t"] == pytest.approx(12)
    assert m["tonnes_coverage"] == pytest.approx(0.75)


def test_supplier_shares_sum_to_one(con):
    total = con.execute("SELECT sum(share_value) FROM mart_supplier WHERE importer = 10").fetchone()[0]
    assert total == pytest.approx(1.0)


def test_supplier_rows(con):
    y = row(con, "SELECT * FROM mart_supplier WHERE importer = 10 AND supplier = 2")
    assert y["value_kusd"] == pytest.approx(50)
    assert y["share_value"] == pytest.approx(50 / 120)
    assert y["rank_value"] == 2
    assert y["quantity_t"] == pytest.approx(2)
    assert y["share_tonnes"] == pytest.approx(2 / 12)


def test_redirectable_supply(con):
    rows = dict(con.execute("SELECT supplier, redirectable_kusd FROM mart_supplier WHERE importer = 10").fetchall())
    assert rows == {1: pytest.approx(40), 2: pytest.approx(0), 3: pytest.approx(0)}


def test_redirectable_identity(con):
    """redirectable + value to this importer == supplier's world basket exports."""
    bad = con.execute("""SELECT count(*) FROM mart_supplier
                         WHERE abs(redirectable_kusd + value_kusd - exports_world_kusd) > 1e-9""").fetchone()[0]
    assert bad == 0


def test_single_supplier_is_fully_concentrated(con):
    m = row(con, "SELECT * FROM mart_importer WHERE importer = 20")
    assert m["supplier_count"] == 1
    assert m["hhi_value"] == pytest.approx(1.0)
    assert m["top1_share_value"] == pytest.approx(1.0)


def test_direct_exposure_bounds():
    assert direct_exposure(100, 0) == 0
    assert direct_exposure(100, 0.4) == pytest.approx(40)
    assert direct_exposure(100, 1) == 100
    with pytest.raises(ValueError):
        direct_exposure(100, 1.2)
