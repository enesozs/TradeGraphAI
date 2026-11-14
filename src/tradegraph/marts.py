"""Build the dependency marts from curated flows + the current basket config."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from tradegraph.config import BasketConfig, PipelineConfig
from tradegraph.curate import curated_dir
from tradegraph.metrics import dependency, movers


def marts_dir(data_dir: Path, release: str, hs: str) -> Path:
    return data_dir / "marts" / f"{hs}_V{release}"


def build_marts(
    cfg: PipelineConfig, baskets: BasketConfig, basket_file: Path, log=print, out_dir: Path | None = None
) -> Path:
    """Build marts. ``out_dir`` lets analysis runs (alternative basket files) avoid overwriting the site's marts."""
    s = cfg.baci
    if (baskets.source_release, baskets.hs_revision) != (f"BACI_V{s.release}", s.hs_revision):
        raise ValueError(
            f"basket config targets {baskets.source_release}/{baskets.hs_revision} but the pipeline "
            f"is configured for BACI_V{s.release}/{s.hs_revision}"
        )
    cur = curated_dir(cfg.data_dir, s)
    out = out_dir or marts_dir(cfg.data_dir, s.release, s.hs_revision)
    out.mkdir(parents=True, exist_ok=True)
    # Single thread: parallel float aggregation is order-dependent, and the marts must be
    # bit-for-bit reproducible from the same inputs (M1 exit gate). The build takes about 1 s either way.
    con = duckdb.connect(config={"threads": 1})
    con.execute(f"""
        CREATE VIEW flows AS SELECT * FROM read_parquet('{cur}/flows/*/*.parquet', hive_partitioning=false);
        CREATE TABLE dim_country AS SELECT * FROM '{cur / "dim_country.parquet"}';
        CREATE TABLE dim_product AS SELECT * FROM '{cur / "dim_product.parquet"}';
    """)
    known = {r[0] for r in con.sql("SELECT product_code FROM dim_product").fetchall()}
    baskets.check_codes_exist(known)
    con.execute("CREATE TABLE basket_codes(basket_id VARCHAR, product_code VARCHAR)")
    con.executemany("INSERT INTO basket_codes VALUES (?, ?)", baskets.rows())

    dependency.build(con)
    mv = cfg.movers
    movers.build(con, mv.start_years, mv.end_years, mv.min_imports_kusd)
    years = [r[0] for r in con.sql("SELECT DISTINCT year FROM flows ORDER BY 1").fetchall()]
    prov = ",".join(str(y) for y in s.provisional_years) or "NULL"

    con.execute(f"""
        COPY (
          SELECT m.*, ci.iso3 AS importer_iso3, ci.country_name AS importer_name,
                 ct.iso3 AS top1_supplier_iso3, ct.country_name AS top1_supplier_name,
                 m.year IN ({prov}) AS is_provisional
          FROM mart_importer m
          JOIN dim_country ci ON ci.country_code = m.importer
          JOIN dim_country ct ON ct.country_code = m.top1_supplier
          ORDER BY basket_id, importer_iso3, year
        ) TO '{out / "importer_basket_year.parquet"}' (FORMAT parquet, COMPRESSION zstd);
        COPY (
          SELECT s.*, ci.iso3 AS importer_iso3, cs.iso3 AS supplier_iso3,
                 cs.country_name AS supplier_name, s.year IN ({prov}) AS is_provisional
          FROM mart_supplier s
          JOIN dim_country ci ON ci.country_code = s.importer
          JOIN dim_country cs ON cs.country_code = s.supplier
          ORDER BY basket_id, importer_iso3, year, rank_value
        ) TO '{out / "supplier_basket_year.parquet"}' (FORMAT parquet, COMPRESSION zstd);
        COPY dim_country TO '{out / "countries.parquet"}' (FORMAT parquet);
        COPY (
          SELECT m.*, ci.iso3 AS importer_iso3, ci.country_name AS importer_name
          FROM movers_importer m JOIN dim_country ci ON ci.country_code = m.importer
          ORDER BY basket_id, importer_iso3
        ) TO '{out / "movers_importer.parquet"}' (FORMAT parquet, COMPRESSION zstd);
        COPY (
          SELECT m.*, ci.iso3 AS importer_iso3, cs.iso3 AS supplier_iso3, cs.country_name AS supplier_name
          FROM movers_supplier m
          JOIN dim_country ci ON ci.country_code = m.importer
          JOIN dim_country cs ON cs.country_code = m.supplier
          ORDER BY basket_id, importer_iso3, supplier_iso3
        ) TO '{out / "movers_supplier.parquet"}' (FORMAT parquet, COMPRESSION zstd);
    """)

    tables = ("mart_importer", "mart_supplier", "movers_importer", "movers_supplier")
    counts = {t: con.sql(f"SELECT count(*) FROM {t}").fetchall()[0][0] for t in tables}
    info = {
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": {
            "name": "CEPII BACI",
            "release": s.release,
            "hs_revision": s.hs_revision,
            "license": "Etalab Open Licence 2.0",
            "citation": "Gaulier, G. and Zignago, S. (2010). BACI: International Trade "
            "Database at the Product-Level. CEPII Working Paper N°2010-23.",
        },
        "units": {"value": "thousand current USD (FOB-reconciled)", "quantity": "metric tonnes"},
        "years": years,
        "provisional_years": s.provisional_years,
        "movers": mv.model_dump(),
        "basket_config_sha256": hashlib.sha256(basket_file.read_bytes()).hexdigest(),
        "baskets": [b.model_dump() for b in baskets.baskets],
        "row_counts": counts,
        "notes": [
            "Shares use each importer's imports from ALL partner countries.",
            "Absent flows are 'not recorded', not zero.",
            "Country code 490 / ISO3 S19 is 'Other Asia, nes' (Taiwan).",
            "redirectable_kusd is an observed upper bound, not feasible substitution.",
        ],
    }
    (out / "build_info.json").write_text(json.dumps(info, indent=1, ensure_ascii=False))
    log(f"marts -> {out}: {counts}")
    return out
