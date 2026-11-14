"""Comext marts on a tiny SDMX-CSV fixture (no network)."""

import json

import duckdb
import pytest

from tradegraph.comext_marts import build
from tradegraph.config import load_baskets, load_pipeline
from tradegraph.ingestion.comext import query_url

HEADER = "DATAFLOW,LAST UPDATE,freq,reporter,partner,product,flow,indicators,TIME_PERIOD,OBS_VALUE\n"


# A slice of BACI's country table (iso2 -> iso3), so the tests need no downloaded data. Namibia's "NA" is restored
# at curation; Taiwan has no ISO2 in BACI (Comext's TW maps to S19 in the pipeline).
COUNTRIES = [
    ("CN", "CHN"), ("CH", "CHE"), ("US", "USA"), ("GR", "GRC"), ("RS", "SRB"), ("NA", "NAM"), ("FR", "FRA"),
    ("IT", "ITA"), ("AT", "AUT"), ("BE", "BEL"), ("BG", "BGR"), ("CY", "CYP"), ("CZ", "CZE"), ("DE", "DEU"),
    ("DK", "DNK"), ("EE", "EST"), ("ES", "ESP"), ("FI", "FIN"), ("HR", "HRV"), ("HU", "HUN"), ("IE", "IRL"),
    ("LT", "LTU"), ("LU", "LUX"), ("LV", "LVA"), ("MT", "MLT"), ("NL", "NLD"), ("PL", "POL"), ("PT", "PRT"),
    ("RO", "ROU"), ("SE", "SWE"), ("SI", "SVN"), ("SK", "SVK"), (None, "S19"),
]  # fmt: skip


def countries_table(tmp_path):
    path = tmp_path / "dim_country.parquet"
    con = duckdb.connect()
    con.execute("CREATE TABLE c(country_code INTEGER, country_name VARCHAR, iso2 VARCHAR, iso3 VARCHAR)")
    con.executemany(
        "INSERT INTO c VALUES (?, ?, ?, ?)", [(i, iso3, iso2, iso3) for i, (iso2, iso3) in enumerate(COUNTRIES)]
    )
    con.execute(f"COPY c TO '{path}' (FORMAT parquet)")
    return path


def line(rep, partner, product, ind, month, v):
    return f"ESTAT:DS-045409(1.0),16/10/26 11:00:00,M,{rep},{partner},{product},1,{ind},{month},{v}\n"


@pytest.fixture()
def built(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    rows = [
        # EU27 imports of Li-ion (850760) in 2026-01: China 60, Germany (intra-EU) 30, Taiwan 10, aggregate code dropped
        line("EU27_2020", "CN", "850760", "VALUE_IN_EUROS", "2026-01", 60),
        line("EU27_2020", "DE", "850760", "VALUE_IN_EUROS", "2026-01", 30),
        line("EU27_2020", "TW", "850760", "VALUE_IN_EUROS", "2026-01", 10),
        line("EU27_2020", "EU27_2020_EXTRA", "850760", "VALUE_IN_EUROS", "2026-01", 70),
        line("EU27_2020", "CN", "850760", "QUANTITY_IN_100KG", "2026-01", 5),
        # Greece reported with Eurostat's code EL
        line("DE", "EL", "850760", "VALUE_IN_EUROS", "2026-01", 4),
        line("DE", "CN", "850760", "VALUE_IN_EUROS", "2026-01", 16),
        # Eurostat's XS (Serbia) and Namibia's NA, whose ISO2 is blank in BACI's country file
        line("FR", "XS", "850760", "VALUE_IN_EUROS", "2026-01", 3),
        line("FR", "NA", "850760", "VALUE_IN_EUROS", "2026-01", 2),
        # product outside every basket -> ignored
        line("DE", "CN", "999999", "VALUE_IN_EUROS", "2026-01", 1000),
    ]
    (raw / "fixture_2026.csv").write_text(HEADER + "".join(rows))
    cfg = load_pipeline()
    out = tmp_path / "marts"
    out.mkdir()
    build(cfg, load_baskets(), raw=raw, out=out, log=lambda *_: None, countries=countries_table(tmp_path))
    return out


def q(out, sql):
    return duckdb.sql(
        sql.replace("IMP", f"'{out / 'comext_importer.parquet'}'").replace(
            "SUP", f"'{out / 'comext_supplier.parquet'}'"
        )
    ).fetchall()


def test_eu_all_partners_and_extra_eu(built):
    eu = q(
        built,
        "SELECT imports_eur, supplier_count, top1_iso3, top1_share, hhi FROM IMP WHERE reporter='EU27_2020' AND basket_id='li_ion_batteries'",
    )[0]
    assert eu[0] == pytest.approx(100)  # aggregate partner code excluded
    assert eu[1] == 3
    assert eu[2] == "CHN" and eu[3] == pytest.approx(0.6)
    assert eu[4] == pytest.approx(0.6**2 + 0.3**2 + 0.1**2)
    extra = q(
        built,
        "SELECT imports_eur, top1_share FROM IMP WHERE reporter='EU27_2020_EXTRA' AND basket_id='li_ion_batteries'",
    )[0]
    assert extra[0] == pytest.approx(70)  # intra-EU (DE) removed
    assert extra[1] == pytest.approx(60 / 70)


def test_partner_code_mapping(built):
    partners = {r[0] for r in q(built, "SELECT partner_iso3 FROM SUP")}
    assert "S19" in partners  # TW -> Other Asia, nes (Taiwan) as in BACI
    assert "GRC" in partners  # EL -> GR -> GRC
    assert "SRB" in partners  # XS -> RS -> SRB
    assert "NAM" in partners  # NA -> NAM (ISO2 restored when BACI's country file is curated)
    assert not any(p is None for p in partners)


def test_out_of_basket_products_ignored(built):
    de = q(built, "SELECT imports_eur FROM IMP WHERE reporter='DE'")
    assert [r[0] for r in de] == [pytest.approx(20)]


def test_info_reports_unmapped_codes(built):
    info = json.loads((built / "comext_info.json").read_text())
    assert info["latest_month"] == "2026-01-01"
    assert any(u["code"] == "EU27_2020_EXTRA" for u in info["unmapped_partner_codes"])


def test_query_url_shape():
    url = query_url(load_pipeline().comext, "DE", ["850760", "854231"], 2025)
    assert "/DS-045409/M.DE..850760+854231.1.VALUE_IN_EUROS+QUANTITY_IN_100KG?" in url
    assert "startPeriod=2025-01" in url and "endPeriod=2025-12" in url and "format=SDMX-CSV" in url


def months(start: str, end: str) -> list[str]:
    y, m = map(int, start.split("-"))
    out = []
    while f"{y}-{m:02d}" <= end:
        out.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


EU_PARTNERS = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "HR", "HU", "IE", "LT", "LU", "LV", "MT", "NL",
               "PL", "PT", "RO"]  # fmt: skip


@pytest.fixture()
def series(tmp_path):
    """Li-ion imports, 2025-01..2026-03, with 21 intra-EU partners a month (a realistic record count).

    IT: China every month, Switzerland skips 2026-01, and every intra-EU partner is missing from 2026-03, like a month
        Eurostat has only partly published.
    FR: starts 2025-08 (no same month a year earlier), same gap in 2026-03.
    ES: a single intra-EU partner that stops in 2026-03: too few records to judge, so not flagged.
    """
    raw = tmp_path / "raw"
    raw.mkdir()
    rows = []
    for m in months("2025-01", "2026-03"):
        rows.append(line("IT", "CN", "850760", "VALUE_IN_EUROS", m, 5))
        if m != "2026-01":
            rows.append(line("IT", "CH", "850760", "VALUE_IN_EUROS", m, 10))
        if m >= "2025-08":
            rows.append(line("FR", "CN", "850760", "VALUE_IN_EUROS", m, 5))
        rows.append(line("ES", "CN", "850760", "VALUE_IN_EUROS", m, 5))
        if m != "2026-03":
            rows += [line("IT", p, "850760", "VALUE_IN_EUROS", m, 1) for p in EU_PARTNERS]
            if m >= "2025-08":
                rows += [line("FR", p, "850760", "VALUE_IN_EUROS", m, 1) for p in EU_PARTNERS]
            rows.append(line("ES", "DE", "850760", "VALUE_IN_EUROS", m, 1))
    (raw / "fixture.csv").write_text(HEADER + "".join(rows))
    out = tmp_path / "marts"
    out.mkdir()
    build(load_pipeline(), load_baskets(), raw=raw, out=out, log=lambda *_: None, countries=countries_table(tmp_path))
    return out


SHARES = """SELECT *, value_eur / sum(value_eur) OVER w AS share, value_eur_12m / sum(value_eur_12m) OVER w AS share_12m
            FROM SUP WINDOW w AS (PARTITION BY reporter, basket_id, month)"""


def test_twelve_month_share_keeps_partner_absent_this_month(series):
    jan = f"SELECT partner_iso3, value_eur, share, share_12m FROM ({SHARES}) WHERE reporter = 'IT' AND month = DATE '2026-01-01'"
    rows = {r[0]: r[1:] for r in q(series, jan)}
    # window 2025-02..2026-01: CH 11 x 10 = 110, CN 12 x 5 = 60, 21 EU partners x 12 x 1 = 252
    assert rows["CHE"][2] == pytest.approx(110 / 422) and rows["CHN"][2] == pytest.approx(60 / 422)
    assert rows["CHE"][:2] == (None, None)  # not recorded this month: empty, not zero
    imp = q(
        series,
        "SELECT supplier_count, top1_iso3_12m, top1_share_12m FROM IMP WHERE reporter = 'IT' AND month = DATE '2026-01-01'",
    )
    assert imp == [(22, "CHE", pytest.approx(110 / 422))]


def test_partly_published_month_is_left_out_and_listed(series):
    last = dict(q(series, "SELECT reporter, max(month)::VARCHAR FROM IMP GROUP BY 1"))
    assert last == {"IT": "2026-02-01", "FR": "2026-02-01", "ES": "2026-03-01"}  # ES: too few records to judge
    assert q(series, "SELECT count(*) FROM SUP WHERE reporter IN ('IT', 'FR') AND month = DATE '2026-03-01'") == [(0,)]
    info = json.loads((series / "comext_info.json").read_text())
    assert info["incomplete_months"] == [
        {"reporter": "FR", "month": "2026-03", "intra_eu_records_vs_usual": 0.0, "extra_eu_records_vs_usual": 1.0},
        {"reporter": "IT", "month": "2026-03", "intra_eu_records_vs_usual": 0.0, "extra_eu_records_vs_usual": 1.0},
    ]
    assert info["latest_month_by_reporter"] == {"IT": "2026-02-01", "FR": "2026-02-01", "ES": "2026-03-01"}
