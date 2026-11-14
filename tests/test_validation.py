"""Each validation check must catch its own violation."""

import duckdb
import pytest

from tradegraph.config import BaciSettings
from tradegraph.curate import ValidationError, load_dimensions, run_checks

GOOD = "(2023, 4, 8, '090111', 1.5, 0.2), (2023, 8, 4, '850760', 3.0, NULL)"


def con_with(rows: str):
    c = duckdb.connect()
    c.execute(f"""
        CREATE TABLE dim_country AS SELECT * FROM (VALUES (4, 'AFG'), (8, 'ALB')) t(country_code, iso3);
        CREATE TABLE dim_product AS SELECT * FROM (VALUES ('090111'), ('850760')) t(product_code);
        CREATE TABLE flows(year INT, exporter INT, importer INT, product_code VARCHAR,
                           value_kusd DOUBLE, quantity_t DOUBLE);
        INSERT INTO flows VALUES {rows};
    """)
    return c


def test_clean_data_passes():
    assert all(v == 0 for v in run_checks(con_with(GOOD), "flows", 2023).values())


@pytest.mark.parametrize(
    ("extra", "label"),
    [
        ("(2023, 4, 8, '090111', 9.9, 1)", "duplicate"),
        ("(2023, 4, 8, '850760', 0, 1)", "non-positive"),
        ("(2023, 8, 4, '090111', 1, -1)", "negative quantities"),
        ("(2023, 4, 8, '90111', 1, 1)", "6 digits"),
        ("(2023, 4, 4, '850760', 1, 1)", "self-flows"),
        ("(2023, 999, 8, '850760', 1, 1)", "unknown country"),
        ("(2023, 8, 4, '123456', 1, 1)", "unknown product"),
        ("(2022, 8, 4, '850760', 1, 1)", "year mismatch"),
    ],
)
def test_each_violation_is_caught(extra, label):
    with pytest.raises(ValidationError, match=label):
        run_checks(con_with(GOOD + ", " + extra), "flows", 2023)


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("CÃ´te d'Ivoire", "Côte d'Ivoire"),
        ("Saint BarthÃ©lemy", "Saint Barthélemy"),
        ("CuraÃ§ao", "Curaçao"),
        ("Germany", "Germany"),  # clean ASCII unchanged
        ("Côte d'Ivoire", "Côte d'Ivoire"),  # already-correct UTF-8 unchanged
        (None, None),
    ],
)
def test_fix_mojibake(raw, clean):
    from tradegraph.curate import fix_mojibake

    assert fix_mojibake(raw) == clean


def test_load_dimensions_restores_namibia_iso2(tmp_path):
    (tmp_path / "country_codes_VX.csv").write_text(
        "country_code,country_name,country_iso2,country_iso3\n516,Namibia,,NAM\n4,Afghanistan,AF,AFG\n490,Other Asia nes,,S19\n"
    )
    (tmp_path / "product_codes_HS12_VX.csv").write_text("code,description\n010121,Horses\n")
    con = duckdb.connect()
    load_dimensions(con, tmp_path, BaciSettings(release="X", hs_revision="HS12", url_template="", years=(2012, 2012)))
    got = dict(con.execute("SELECT iso3, iso2 FROM dim_country").fetchall())
    assert got == {"NAM": "NA", "AFG": "AF", "S19": None}  # blanks elsewhere stay missing
