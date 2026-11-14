"""Turn raw BACI CSVs into validated, typed Parquet (all products, all countries).

Storing every product means baskets can be changed later without re-ingesting.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import duckdb

from tradegraph.config import BaciSettings
from tradegraph.ingestion.baci import raw_dir, year_file

CSV_COLUMNS = "{'t':'INTEGER','i':'INTEGER','j':'INTEGER','k':'VARCHAR','v':'DOUBLE','q':'VARCHAR'}"


class ValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Check:
    name: str
    sql: str  # must return a single integer: number of violating rows


# Every check counts violations; any non-zero count fails the build.
FLOW_CHECKS = [
    Check(
        "duplicate (year, exporter, importer, product) keys",
        "SELECT count(*) FROM (SELECT 1 FROM {t} GROUP BY year, exporter, importer, product_code HAVING count(*) > 1)",
    ),
    Check("non-positive values", "SELECT count(*) FROM {t} WHERE value_kusd IS NULL OR value_kusd <= 0"),
    Check("negative quantities", "SELECT count(*) FROM {t} WHERE quantity_t < 0"),
    Check(
        "product code not 6 digits", "SELECT count(*) FROM {t} WHERE NOT regexp_full_match(product_code, '[0-9]{{6}}')"
    ),
    Check("self-flows (exporter = importer)", "SELECT count(*) FROM {t} WHERE exporter = importer"),
    Check(
        "unknown country codes",
        "SELECT count(*) FROM {t} f WHERE NOT EXISTS (SELECT 1 FROM {c} c WHERE c.country_code = f.exporter)"
        " OR NOT EXISTS (SELECT 1 FROM {c} c WHERE c.country_code = f.importer)",
    ),
    Check(
        "unknown product codes",
        "SELECT count(*) FROM {t} f WHERE NOT EXISTS (SELECT 1 FROM {p} p WHERE p.product_code = f.product_code)",
    ),
    Check("year mismatch", "SELECT count(*) FROM {t} WHERE year <> {year}"),
]


def run_checks(
    con: duckdb.DuckDBPyConnection, table: str, year: int, countries: str = "dim_country", products: str = "dim_product"
) -> dict[str, int]:
    results = {}
    for chk in FLOW_CHECKS:
        sql = chk.sql.format(t=table, c=countries, p=products, year=year)
        results[chk.name] = con.sql(sql).fetchall()[0][0]
    if empty := (con.sql(f"SELECT count(*) FROM {table}").fetchall()[0][0] == 0):
        results["empty table"] = int(empty)
    failed = {k: v for k, v in results.items() if v}
    if failed:
        raise ValidationError(f"{table} ({year}) failed: {failed}")
    return results


def curated_dir(data_dir: Path, s: BaciSettings) -> Path:
    return data_dir / "curated" / "baci" / f"{s.hs_revision}_V{s.release}"


def load_dimensions(con: duckdb.DuckDBPyConnection, raw: Path, s: BaciSettings) -> None:
    con.execute(f"""
        CREATE OR REPLACE TABLE dim_country AS
        SELECT CAST(country_code AS INTEGER) AS country_code, country_name,
               -- BACI's file leaves Namibia's ISO2 blank (its code "NA" was presumably lost as a missing value
               -- when the file was written); restore it so ISO2-keyed sources such as Eurostat can join.
               CASE WHEN country_iso3 = 'NAM' THEN coalesce(nullif(country_iso2, ''), 'NA')
                    ELSE nullif(country_iso2, '') END AS iso2,
               country_iso3 AS iso3
        FROM read_csv('{raw / f"country_codes_V{s.release}.csv"}', header=true, all_varchar=true);
        CREATE OR REPLACE TABLE dim_product AS
        SELECT code AS product_code, description, '{s.hs_revision}' AS hs_revision
        FROM read_csv('{raw / f"product_codes_{s.hs_revision}_V{s.release}.csv"}', header=true,
                      all_varchar=true);
    """)
    # BACI's country file contains double-encoded UTF-8 (e.g. "CÃ´te d'Ivoire"); repair names in place.
    fixed = [
        (fix_mojibake(n), c) for c, n in con.execute("SELECT country_code, country_name FROM dim_country").fetchall()
    ]
    con.executemany("UPDATE dim_country SET country_name = ? WHERE country_code = ?", fixed)


def fix_mojibake(text: str | None) -> str | None:
    """Undo UTF-8 text that was decoded as Latin-1 and re-encoded ("Ã´" -> "ô"). Leaves clean text unchanged."""
    if text is None:
        return None
    try:
        repaired = text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text
    return repaired


def write_dimensions(s: BaciSettings, data_dir: Path) -> duckdb.DuckDBPyConnection:
    """Write dim_country and dim_product parquet files; returns the connection holding both tables."""
    raw, out = raw_dir(data_dir, s), curated_dir(data_dir, s)
    out.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    load_dimensions(con, raw, s)
    con.execute(f"COPY dim_country TO '{out / 'dim_country.parquet'}' (FORMAT parquet)")
    con.execute(f"COPY dim_product TO '{out / 'dim_product.parquet'}' (FORMAT parquet)")
    return con


def curate(s: BaciSettings, data_dir: Path, years: list[int] | None = None, log=print) -> dict:
    raw, out = raw_dir(data_dir, s), curated_dir(data_dir, s)
    con = write_dimensions(s, data_dir)
    report = {}
    for y in years or s.year_list:
        src = raw / year_file(s, y)
        if not src.exists():
            raise FileNotFoundError(f"{src} missing; run `tradegraph fetch` first")
        con.execute(f"""
            CREATE OR REPLACE TEMP TABLE flows AS
            SELECT t AS year, i AS exporter, j AS importer, k AS product_code,
                   v AS value_kusd, TRY_CAST(trim(q) AS DOUBLE) AS quantity_t
            FROM read_csv('{src}', header=true, columns={CSV_COLUMNS})
        """)
        checks = run_checks(con, "flows", y)
        stats = con.sql("SELECT count(*), sum(value_kusd), avg((quantity_t IS NULL)::INT) FROM flows").fetchall()[0]
        dest = out / "flows" / f"year={y}"
        dest.mkdir(parents=True, exist_ok=True)
        con.execute(
            f"COPY (SELECT * FROM flows ORDER BY product_code, importer, exporter) "
            f"TO '{dest / 'part-0.parquet'}' (FORMAT parquet, COMPRESSION zstd)"
        )
        report[y] = {
            "rows": stats[0],
            "value_kusd": stats[1],
            "q_missing_share": stats[2],
            "checks_passed": len(checks),
        }
        log(f"curate {y}: {stats[0]:,} rows, {len(checks)} checks passed")
    return report
