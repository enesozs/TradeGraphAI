"""ML F (EU scope): observed transport-mode split of EU imports from outside the EU, per basket and partner.

Input: Eurostat Comext TRANSPORT_HS archives (see ingestion/transport.py). Each archive is extracted to a temporary
folder, filtered to imports (FLOW 1) of the basket HS6 products, and appended to a curated parquet; the temporary
CSV is deleted. Output marts:
  transport_mode.parquet   reporter (EU27_2020_EXTRA or member-state ISO3) x basket x year x partner x mode group:
                           value (EUR) and quantity (kg). Years: complete years, plus the current year to date
                           (flagged by `months`).
  transport_info.json      coverage, mode-code mapping, source and attribution.
Mode is the active means of transport at the EU's external border.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import duckdb
import py7zr

from tradegraph.config import BasketConfig, PipelineConfig
from tradegraph.curate import curated_dir as baci_curated
from tradegraph.eurostat_codes import EU27, to_iso2_sql
from tradegraph.ingestion.transport import raw_dir
from tradegraph.marts import marts_dir

# Eurostat transport-mode codes (active means of transport at the external border) -> display groups
MODE_GROUP = {
    "1": "sea", "8": "sea",  # sea; inland waterway
    "4": "air", "5": "air",  # air; postal consignments (mostly air)
    "3": "road",
    "2": "rail",
    "7": "other", "9": "other", "0": "other",  # fixed installations (pipelines, cables); own propulsion; not known
}  # fmt: skip


def curated_path(data_dir: Path) -> Path:
    return data_dir / "curated" / "eurostat_transport" / "imports_baskets.parquet"


def extract_filtered(archive: Path, products: list[str], out_parquet: Path) -> int:
    """Extract one archive, keep extra-EU imports of ``products``, write them to ``out_parquet``; returns rows."""
    tmp = Path(tempfile.mkdtemp(prefix="trhs_"))
    try:
        with py7zr.SevenZipFile(archive, "r") as z:
            z.extractall(tmp)
        csvs = [p for p in tmp.rglob("*") if p.is_file()]
        prods = ",".join(f"'{p}'" for p in products)
        con = duckdb.connect()
        con.execute(f"""
            COPY (
              SELECT REPORTER AS reporter, PARTNER AS partner, lpad(PRODUCT, 6, '0') AS product, TRANSPORT_MODE AS mode,
                     PERIOD AS period, TRY_CAST(VALUE_EUR AS DOUBLE) AS value_eur, TRY_CAST(QUANTITY_KG AS DOUBLE) AS kg
              FROM read_csv([{",".join(f"'{p}'" for p in csvs)}], header = true, all_varchar = true)
              WHERE FLOW = '1' AND lpad(PRODUCT, 6, '0') IN ({prods})  -- codes lose their leading zero
            ) TO '{out_parquet}' (FORMAT parquet)
        """)  # noqa: S608
        return con.execute(f"SELECT count(*) FROM '{out_parquet}'").fetchall()[0][0]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def curate(cfg: PipelineConfig, baskets: BasketConfig, log=print) -> Path:
    raw = raw_dir(cfg.data_dir)
    out = curated_path(cfg.data_dir)
    parts = out.parent / "parts"
    parts.mkdir(parents=True, exist_ok=True)
    products = sorted({c for _, c in baskets.rows()})
    manifest = json.loads((raw / "manifest.json").read_text())
    for name in sorted(manifest):
        part = parts / name.replace(".7z", ".parquet")
        if part.exists() and part.stat().st_mtime >= (raw / name).stat().st_mtime:
            continue
        n = extract_filtered(raw / name, products, part)
        log(f"transport: {name} -> {n:,} rows")
    duckdb.execute(f"COPY (SELECT * FROM '{parts}/*.parquet') TO '{out}' (FORMAT parquet)")
    return out


def build(cfg: PipelineConfig, baskets: BasketConfig, log=print) -> Path:
    curated = curate(cfg, baskets, log)
    out = marts_dir(cfg.data_dir, cfg.baci.release, cfg.baci.hs_revision)
    con = duckdb.connect()
    con.register("basket_codes", _basket_codes(baskets))
    dim = baci_curated(cfg.data_dir, cfg.baci) / "dim_country.parquet"
    groups = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in MODE_GROUP.items())
    eu = ",".join(f"'{c}'" for c in EU27)
    con.execute(f"""
      CREATE TABLE t AS
      SELECT {to_iso2_sql("r.reporter")} AS rep2, {to_iso2_sql("r.partner")} AS par2,
             b.basket_id, CAST(substr(r.period, 1, 4) AS INT) AS year,
             CASE WHEN substr(r.period, 5, 2) = '52' THEN 0 ELSE CAST(substr(r.period, 5, 2) AS INT) END AS month,
             CASE r.mode {groups} ELSE 'other' END AS mode, r.value_eur, r.kg
      FROM '{curated}' r JOIN basket_codes b ON b.product_code = r.product;
      CREATE TABLE iso AS SELECT DISTINCT iso2, iso3 FROM '{dim}' WHERE iso2 IS NOT NULL
        AND iso3 NOT IN ('ANT','CSK','DDR','SCG','SUN','ZA1');
    """)  # noqa: S608
    annualise(con)
    con.execute(f"""
      COPY (
        WITH m AS (
          SELECT a.*, coalesce(p.iso3, CASE WHEN a.par2 = 'S19' THEN 'S19' END) AS partner_iso3,
                 coalesce(r.iso3, a.rep2) AS reporter_iso3
          FROM annual a LEFT JOIN iso p ON p.iso2 = a.par2 LEFT JOIN iso r ON r.iso2 = a.rep2
          WHERE a.rep2 IN ({eu}) AND a.par2 NOT IN ({eu}))
        SELECT reporter_iso3 AS reporter, partner_iso3, basket_id, year, months, mode, sum(value_eur) AS value_eur, sum(kg) AS kg
        FROM m WHERE partner_iso3 IS NOT NULL GROUP BY ALL
        UNION ALL
        SELECT 'EU27_2020_EXTRA', partner_iso3, basket_id, year, months, mode, sum(value_eur), sum(kg)
        FROM m WHERE partner_iso3 IS NOT NULL GROUP BY ALL
      ) TO '{out / "transport_mode.parquet"}' (FORMAT parquet, COMPRESSION zstd)
    """)  # noqa: S608
    cov = con.execute(
        f"SELECT min(year), max(year), max(months) FILTER (WHERE year = (SELECT max(year) FROM '{out / 'transport_mode.parquet'}')) FROM '{out / 'transport_mode.parquet'}'"
    ).fetchall()[0]
    unmapped = con.execute(
        f"SELECT DISTINCT par2 FROM annual WHERE par2 NOT IN (SELECT iso2 FROM iso) AND par2 NOT IN ({eu}) AND par2 <> 'S19'"
    ).fetchall()
    info = {
        "source": "Eurostat Comext, extra-EU trade by mode of transport (HS6), bulk TRANSPORT_HS",
        "attribution": "Source: Eurostat (Comext, extra-EU trade by mode of transport, HS6), © European Union; adapted by TradeGraph AI. Eurostat is not responsible for the adapted figures.",
        "scope": "EU member states' imports from outside the EU; mode at the EU's external border",
        "first_year": cov[0], "last_year": cov[1], "last_year_months": cov[2],
        "mode_groups": MODE_GROUP,
        "unmapped_partner_codes": sorted(r[0] for r in unmapped),
    }  # fmt: skip
    (out / "transport_info.json").write_text(json.dumps(info, indent=2))
    log(f"transport -> {out}: years {cov[0]}-{cov[1]} (last year {cov[2]} months); unmapped partners {len(unmapped)}")
    return out


def annualise(con: duckdb.DuckDBPyConnection) -> None:
    """Create table ``annual`` from table ``t`` (rep2, par2, basket_id, year, month, mode, value_eur, kg).

    Complete years come from the annual files (month 0). A year without an annual file is summed over its monthly
    files, and ``months`` is the number of months loaded for that YEAR (not per row), so every row of a year carries
    the same coverage and no key is split by it. Raises if a part-year's months are not January..n.
    """
    con.execute("""
      CREATE OR REPLACE TABLE year_months AS
      SELECT year, CASE WHEN min(month) = 0 THEN 12 ELSE count(DISTINCT month) END AS months,
             CASE WHEN min(month) = 0 THEN 12 ELSE max(month) END AS last_month
      FROM t WHERE month = 0 OR year NOT IN (SELECT year FROM t WHERE month = 0)
      GROUP BY year;
    """)
    gaps = con.execute("SELECT year, months, last_month FROM year_months WHERE months <> last_month").fetchall()
    if gaps:
        raise ValueError(f"monthly transport files have gaps (year, months loaded, last month): {gaps}")
    con.execute("""
      CREATE OR REPLACE TABLE annual AS
      SELECT t.rep2, t.par2, t.basket_id, t.year, y.months, t.mode, sum(t.value_eur) AS value_eur, sum(t.kg) AS kg
      FROM t JOIN year_months y USING (year)
      WHERE t.month = 0 OR t.year NOT IN (SELECT year FROM t WHERE month = 0)
      GROUP BY ALL;
    """)


def _basket_codes(baskets: BasketConfig):
    import pandas as pd

    return pd.DataFrame([{"basket_id": b, "product_code": c} for b, c in baskets.rows()])
