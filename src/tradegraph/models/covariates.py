"""Gravity pair covariates from CEPII Gravity, aligned to BACI country codes.

Outputs (data/curated/gravity/V<release>/):
  pairs.parquet : iso3_o, iso3_d, dist_km, contig, comlang_off, colony  (time-invariant)
  rta.parquet   : iso3_o, iso3_d, year, rta  (2012..last BACI year; carried forward after 2020)

BACI-specific code: S19 ("Other Asia, nes") is Taiwan in practice and takes TWN's covariates.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

from tradegraph.config import PipelineConfig
from tradegraph.ingestion.gravity import main_file, raw_dir

BACI_TO_GRAVITY_ISO3 = {"S19": "TWN"}


def curated_dir(data_dir: Path, release: str) -> Path:
    return data_dir / "curated" / "gravity" / f"V{release}"


def curate(cfg: PipelineConfig, log=print) -> Path:
    g = cfg.gravity
    src = raw_dir(cfg.data_dir, g) / main_file(g)
    out = curated_dir(cfg.data_dir, g.release)
    out.mkdir(parents=True, exist_ok=True)
    y0, y1 = cfg.baci.years
    con = duckdb.connect()
    con.execute(f"""
        CREATE TABLE g AS
        SELECT year, iso3_o, iso3_d, dist, contig, comlang_off, col_dep_ever, fta_wto
        FROM read_csv('{src}', header=true, all_varchar=true)
        WHERE CAST(year AS INT) BETWEEN {y0} AND {y1}
          AND country_exists_o = '1' AND country_exists_d = '1' AND iso3_o <> iso3_d
    """)
    last = con.sql("SELECT max(CAST(year AS INT)) FROM g").fetchall()[0][0]
    # Time-invariant pair attributes: latest year with a non-missing distance.
    # Gravity leaves some binary attributes missing for some pairs (e.g. CHN->HKG comlang). These are
    # symmetric relations, so fill from the reverse pair first; anything still missing becomes 0 with
    # cov_missing = 1, and the model gives those pairs their own average effect.
    con.execute(f"""
        CREATE TABLE p AS
          SELECT iso3_o, iso3_d,
                 arg_max(TRY_CAST(dist AS DOUBLE), CAST(year AS INT)) FILTER (WHERE TRY_CAST(dist AS DOUBLE) > 0) AS dist_km,
                 max(TRY_CAST(contig AS INT))       AS contig,
                 max(TRY_CAST(comlang_off AS INT))  AS comlang_off,
                 max(TRY_CAST(col_dep_ever AS INT)) AS colony
          FROM g GROUP BY ALL HAVING dist_km IS NOT NULL;
        COPY (
          SELECT a.iso3_o, a.iso3_d, a.dist_km,
                 coalesce(a.contig, b.contig, 0)            AS contig,
                 coalesce(a.comlang_off, b.comlang_off, 0)  AS comlang_off,
                 coalesce(a.colony, b.colony, 0)            AS colony,
                 (coalesce(a.contig, b.contig) IS NULL OR coalesce(a.comlang_off, b.comlang_off) IS NULL
                  OR coalesce(a.colony, b.colony) IS NULL)::INT AS cov_missing
          FROM p a LEFT JOIN p b ON b.iso3_o = a.iso3_d AND b.iso3_d = a.iso3_o
          ORDER BY 1, 2
        ) TO '{out / "pairs.parquet"}' (FORMAT parquet)
    """)
    carry = "TRUE" if g.rta_carry_forward else "FALSE"
    con.execute(f"""
        COPY (
          WITH obs AS (
            SELECT iso3_o, iso3_d, CAST(year AS INT) AS year, TRY_CAST(fta_wto AS INT) AS rta FROM g
          ), last AS (
            SELECT iso3_o, iso3_d, rta FROM obs WHERE year = {last}
          ), fwd AS (
            SELECT l.iso3_o, l.iso3_d, y.year, l.rta
            FROM last l CROSS JOIN range({last} + 1, {y1} + 1) y(year)
            WHERE {carry}
          )
          SELECT * FROM obs UNION ALL SELECT * FROM fwd ORDER BY 1, 2, 3
        ) TO '{out / "rta.parquet"}' (FORMAT parquet)
    """)
    # ISO 3166 numeric codes (for map geometry; BACI's own numeric codes are Comtrade-style, not ISO).
    con.execute(f"""
        COPY (SELECT iso3, TRY_CAST(iso3num AS INT) AS iso_num, country AS name
              FROM read_csv('{raw_dir(cfg.data_dir, g) / f"Countries_V{g.release}.csv"}', header=true, all_varchar=true)
              WHERE TRY_CAST(iso3num AS INT) IS NOT NULL AND (last_year IS NULL OR last_year = ''))
          TO '{out / "countries.parquet"}' (FORMAT parquet)
    """)
    n_pairs = con.sql(f"SELECT count(*) FROM '{out / 'pairs.parquet'}'").fetchall()[0][0]
    log(f"gravity covariates: {n_pairs:,} pairs; RTA observed to {last}, carried forward to {y1}: {carry}")
    return out
