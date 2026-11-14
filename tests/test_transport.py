"""ML F: extraction filter, Eurostat code mapping and part-year coverage on hand-built data."""

import duckdb
import py7zr
import pytest

from tradegraph.eurostat_codes import EU27, to_iso2, to_iso2_sql
from tradegraph.transport_marts import MODE_GROUP, annualise, extract_filtered

HEADER = "REPORTER,PARTNER,PRODUCT,FLOW,TRANSPORT_MODE,PERIOD,VALUE_EUR,VALUE_NAC,QUANTITY_KG\n"
ROWS = [
    "DE,CN,850760,1,1,202352,1000,1000,500",  # import, sea, basket product
    "DE,CN,850760,1,4,202352,300,300,10",  # import, air
    "DE,CN,850760,2,1,202352,999,999,99",  # export: dropped
    "DE,CN,010121,1,1,202352,50,50,5",  # not a basket product: dropped
    "FR,US,854231,1,4,202352,700,700,1",
    "IT,BR,90111,1,1,202352,40,40,30",  # coffee 090111 without its leading zero
]


def test_extract_filters_imports_of_basket_products(tmp_path):
    csv = tmp_path / "trhs.csv"
    csv.write_text(HEADER + "\n".join(ROWS) + "\n")
    arc = tmp_path / "trhs_v2_202352.7z"
    with py7zr.SevenZipFile(arc, "w") as z:
        z.write(csv, "trhs.csv")
    out = tmp_path / "part.parquet"
    n = extract_filtered(arc, ["850760", "854231", "090111"], out)
    assert n == 4
    rows = duckdb.sql(
        f"SELECT reporter, partner, product, mode, value_eur, kg FROM '{out}' ORDER BY value_eur"
    ).fetchall()
    assert rows == [("IT", "BR", "090111", "1", 40.0, 30.0), ("DE", "CN", "850760", "4", 300.0, 10.0), ("FR", "US", "854231", "4", 700.0, 1.0),
                    ("DE", "CN", "850760", "1", 1000.0, 500.0)]  # fmt: skip


def test_mode_groups_cover_eurostat_codes():
    assert {MODE_GROUP[c] for c in "1234578 90".replace(" ", "")} == {"sea", "air", "road", "rail", "other"}
    assert MODE_GROUP["8"] == "sea" and MODE_GROUP["5"] == "air"


def test_eurostat_codes_to_iso2():
    assert [to_iso2(c) for c in ["XS", "EL", "UK", "TW", "DE", "NA"]] == ["RS", "GR", "GB", "S19", "DE", "NA"]
    got = duckdb.sql(f"SELECT {to_iso2_sql('c')} FROM (VALUES ('XS'), ('NA'), ('EL')) v(c)").fetchall()
    assert [r[0] for r in got] == ["RS", "NA", "GR"]
    assert len(EU27) == 27 and "GR" in EU27 and "EL" not in EU27


def t_table(rows):
    con = duckdb.connect()
    con.execute("CREATE TABLE t(rep2 VARCHAR, par2 VARCHAR, basket_id VARCHAR, year INT, month INT, mode VARCHAR,"
                " value_eur DOUBLE, kg DOUBLE)")  # fmt: skip
    con.executemany("INSERT INTO t VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows)
    return con


def test_annualise_sets_months_per_year_not_per_row():
    con = t_table([
        ("DE", "CN", "b", 2025, 0, "sea", 100.0, 1.0),  # complete year from the annual file
        ("DE", "CN", "b", 2026, 1, "sea", 10.0, 1.0),  # part-year: CN ships in January and March
        ("DE", "CN", "b", 2026, 3, "sea", 30.0, 1.0),
        ("DE", "US", "b", 2026, 2, "air", 5.0, 1.0),  # US ships only in February
    ])  # fmt: skip
    annualise(con)
    got = con.execute("SELECT par2, year, months, value_eur FROM annual ORDER BY year, par2").fetchall()
    assert got == [("CN", 2025, 12, 100.0), ("CN", 2026, 3, 40.0), ("US", 2026, 3, 5.0)]
    # one EU-wide row per key: months never splits a group
    dup = con.execute("SELECT count(*) FROM (SELECT year, mode, count(*) n FROM annual GROUP BY ALL HAVING n > 1)")
    assert dup.fetchall()[0][0] == 0


def test_annualise_prefers_annual_file_and_rejects_month_gaps():
    con = t_table([("DE", "CN", "b", 2025, 0, "sea", 100.0, 1.0), ("DE", "CN", "b", 2025, 6, "sea", 9.0, 1.0)])
    annualise(con)
    assert con.execute("SELECT months, value_eur FROM annual").fetchall() == [(12, 100.0)]
    gap = t_table([("DE", "CN", "b", 2026, 1, "sea", 1.0, 1.0), ("DE", "CN", "b", 2026, 3, "sea", 1.0, 1.0)])
    with pytest.raises(ValueError, match="gaps"):
        annualise(gap)
