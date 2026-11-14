"""L3 marts: monthly EU import dependency from Eurostat Comext (EUR values; kept separate from BACI).

Outputs (marts dir):
  comext_importer.parquet  reporter x basket x month: imports, supplier count, HHI, top supplier and share,
                           plus trailing-12-month versions (smoother than single months)
  comext_supplier.parquet  reporter x basket x month x partner: value, quantity, trailing-12m value (shares are
                           value / the month's total; they are left out of the file to keep it small for the app)
  comext_info.json         coverage, latest month, Eurostat last-update stamp, unmapped partner codes

"EU27_2020" reports the bloc's total imports including trade between EU members; "EU27_2020_EXTRA"
is the same bloc counting only partners outside the EU, which is the meaningful view of EU dependency.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from tradegraph.config import BasketConfig, PipelineConfig
from tradegraph.curate import curated_dir as baci_curated
from tradegraph.eurostat_codes import EU27, ISO2_FIX
from tradegraph.ingestion.comext import raw_dir
from tradegraph.marts import marts_dir

SQL = """
CREATE OR REPLACE TABLE raw AS
SELECT reporter, partner, product, indicators AS indicator,
       strptime(TIME_PERIOD, '%Y-%m')::DATE AS month, TRY_CAST(OBS_VALUE AS DOUBLE) AS v, "LAST UPDATE" AS last_update
FROM read_csv('{raw}/*.csv', header=true, all_varchar=true, union_by_name=true);

CREATE OR REPLACE TABLE obs AS
SELECT reporter, partner, product, month,
       sum(v) FILTER (WHERE indicator = 'VALUE_IN_EUROS')    AS value_eur,
       sum(v) FILTER (WHERE indicator = 'QUANTITY_IN_100KG') AS qty_100kg
FROM raw GROUP BY ALL;

-- partner code -> BACI ISO3 (2-letter codes only; aggregates and special codes are dropped and reported)
CREATE OR REPLACE TABLE pmap AS
SELECT DISTINCT o.partner,
       coalesce(c.iso3, CASE WHEN o.partner = 'TW' THEN 'S19' END) AS partner_iso3
FROM obs o
LEFT JOIN iso2fix f ON f.code = o.partner
LEFT JOIN dim_country c ON c.iso2 = coalesce(f.iso2, o.partner) AND c.iso3 NOT IN ('ANT','CSK','DDR','SCG','SUN','ZA1');

CREATE OR REPLACE TABLE flows AS
SELECT o.reporter, b.basket_id, o.month, p.partner_iso3, o.partner AS partner_code,
       sum(o.value_eur) AS value_eur, sum(o.qty_100kg) AS qty_100kg
FROM obs o JOIN basket_codes b ON b.product_code = o.product JOIN pmap p USING (partner)
WHERE p.partner_iso3 IS NOT NULL AND o.value_eur > 0 AND o.partner <> o.reporter
GROUP BY ALL;

-- Extra-EU view of the bloc
INSERT INTO flows
SELECT 'EU27_2020_EXTRA', basket_id, month, partner_iso3, partner_code, value_eur, qty_100kg
FROM flows WHERE reporter = 'EU27_2020' AND partner_code NOT IN (SELECT code FROM eu27);

CREATE OR REPLACE TABLE ttm AS  -- trailing 12 months (only where 12 months are available)
SELECT f.reporter, f.basket_id, m.month, f.partner_iso3, sum(f.value_eur) AS value_eur_12m
FROM (SELECT DISTINCT reporter, basket_id, month FROM flows) m
JOIN flows f ON f.reporter = m.reporter AND f.basket_id = m.basket_id
            AND f.month > m.month - INTERVAL 12 MONTH AND f.month <= m.month
WHERE m.month >= (SELECT min(month) FROM flows) + INTERVAL 11 MONTH
GROUP BY ALL;

-- One row per partner with imports in the month OR in the trailing 12 months: a partner with no record this month
-- keeps its 12-month total (value_eur and share stay NULL: not recorded, not zero).
CREATE OR REPLACE TABLE supplier AS
SELECT *, value_eur / sum(value_eur) OVER (PARTITION BY reporter, basket_id, month) AS share,
       value_eur_12m / sum(value_eur_12m) OVER (PARTITION BY reporter, basket_id, month) AS share_12m
FROM flows FULL JOIN ttm USING (reporter, basket_id, month, partner_iso3);

-- Eurostat publishes a new month before all of it is in (e.g. trade between member states can follow later). A
-- reporter's month is incomplete when its intra-EU or extra-EU partner records (all baskets) fall below
-- {min_coverage} x the reporter's usual count: the median over its previous 12 months, needing at least 6 of them and
-- a usual count of at least {min_base} records (too few to judge otherwise). Only the trailing run of such months is
-- incomplete; earlier months are final. Incomplete months are left out of the published marts (see build()).
CREATE OR REPLACE TABLE coverage AS
WITH c AS (
  SELECT reporter, month,
         count(*) FILTER (WHERE partner_code IN (SELECT code FROM eu27)) AS n_intra,
         count(*) FILTER (WHERE partner_code NOT IN (SELECT code FROM eu27)) AS n_extra
  FROM flows GROUP BY ALL),
b AS (
  SELECT a.reporter, a.month, a.n_intra, a.n_extra, median(p.n_intra) AS usual_intra, median(p.n_extra) AS usual_extra,
         count(p.month) AS usual_months
  FROM c a LEFT JOIN c p ON p.reporter = a.reporter AND p.month < a.month AND p.month >= a.month - INTERVAL 12 MONTH
  GROUP BY ALL),
d AS (
  SELECT *, coalesce(usual_months >= 6 AND ((usual_intra >= {min_base} AND n_intra < {min_coverage} * usual_intra)
                                       OR (usual_extra >= {min_base} AND n_extra < {min_coverage} * usual_extra)), false) AS short,
         n_intra / nullif(usual_intra, 0) AS intra_vs_usual, n_extra / nullif(usual_extra, 0) AS extra_vs_usual
  FROM b)
SELECT *, NOT (short AND month > coalesce(max(month) FILTER (WHERE NOT short) OVER (PARTITION BY reporter), DATE '1900-01-01')) AS complete
FROM d;

CREATE OR REPLACE TABLE importer AS
SELECT reporter, basket_id, month,
       sum(value_eur) AS imports_eur, count(value_eur) AS supplier_count,
       sum(share * share) AS hhi,
       arg_max(partner_iso3, value_eur) AS top1_iso3, max(share) AS top1_share,
       sum(share_12m * share_12m) AS hhi_12m,
       arg_max(partner_iso3, value_eur_12m) AS top1_iso3_12m, max(share_12m) AS top1_share_12m
FROM supplier GROUP BY ALL;
"""


MAX_UNMAPPED_COUNTRY_SHARE = 0.005
# A month whose intra-EU or extra-EU partner records fall below this share of the reporter's usual count (median of
# the previous 12 months) is treated as not yet fully published. Complete months 2018-2026 stay within 0.79-1.20;
# Eurostat's first August 2026 release had no intra-EU records for five member states and the EU total.
MIN_MONTH_COVERAGE = 0.5
MIN_USUAL_RECORDS = 20  # below this usual count the check is skipped (normal churn, not a publication gap)


class ComextValidationError(RuntimeError):
    pass


def build(
    cfg: PipelineConfig,
    baskets: BasketConfig,
    log=print,
    raw: Path | None = None,
    out: Path | None = None,
    countries: Path | None = None,
) -> Path:
    """Build the Comext marts. ``countries`` defaults to BACI's curated country table (iso2 -> iso3)."""
    raw = raw or raw_dir(cfg.data_dir, cfg.comext)
    out = out or marts_dir(cfg.data_dir, cfg.baci.release, cfg.baci.hs_revision)
    countries = countries or baci_curated(cfg.data_dir, cfg.baci) / "dim_country.parquet"
    con = duckdb.connect(config={"threads": 1})
    con.execute(f"CREATE TABLE dim_country AS SELECT * FROM '{countries}'")
    con.execute("CREATE TABLE basket_codes(basket_id VARCHAR, product_code VARCHAR)")
    con.executemany("INSERT INTO basket_codes VALUES (?, ?)", baskets.rows())
    con.execute("CREATE TABLE iso2fix(code VARCHAR, iso2 VARCHAR)")
    con.executemany("INSERT INTO iso2fix VALUES (?, ?)", [(k, v) for k, v in ISO2_FIX.items() if v != "S19"])
    con.execute("CREATE TABLE eu27(code VARCHAR)")
    con.executemany("INSERT INTO eu27 VALUES (?)", [(c,) for c in EU27])
    con.execute(SQL.format(raw=raw, min_coverage=MIN_MONTH_COVERAGE, min_base=MIN_USUAL_RECORDS))

    checks = {
        "negative values": "SELECT count(*) FROM obs WHERE value_eur < 0 OR qty_100kg < 0",
        "duplicate keys": "SELECT count(*) FROM (SELECT 1 FROM flows GROUP BY reporter, basket_id, month, partner_iso3 HAVING count(*) > 1)",
        "shares not summing to 1": "SELECT count(*) FROM (SELECT sum(share) s FROM supplier GROUP BY reporter, basket_id, month) WHERE abs(s - 1) > 1e-9",
        "12-month shares not summing to 1": "SELECT count(*) FROM (SELECT sum(share_12m) s FROM supplier GROUP BY reporter, basket_id, month) WHERE abs(s - 1) > 1e-9",
    }  # fmt: skip
    failed = {k: n for k, q in checks.items() if (n := con.sql(q).fetchall()[0][0])}
    if failed:
        raise ComextValidationError(f"Comext validation failed: {failed}")

    unmapped = con.sql("""
        SELECT o.partner, round(sum(o.value_eur) / (SELECT sum(value_eur) FROM obs WHERE value_eur > 0), 6) AS value_share
        FROM obs o JOIN pmap p USING (partner) WHERE p.partner_iso3 IS NULL AND o.value_eur > 0
        GROUP BY 1 ORDER BY 2 DESC""").fetchall()
    # Aggregate codes (WORLD, EXT_EU27_2020, ...) are expected to be unmapped; unmapped 2-letter country codes must stay tiny.
    country_unmapped = sum(v for c, v in unmapped if len(c) == 2)
    if country_unmapped > MAX_UNMAPPED_COUNTRY_SHARE:
        raise ComextValidationError(
            f"unmapped partner countries carry {country_unmapped:.2%} of value; extend ISO2_FIX"
        )
    # Published marts hold complete months only, so no consumer has to filter; the held-back months are listed in
    # comext_info.json. (Earlier months' trailing-12-month windows never include them: they are the latest months.)
    keep = "JOIN (SELECT reporter, month FROM coverage WHERE complete) USING (reporter, month)"
    con.execute(
        f"COPY (SELECT importer.* FROM importer {keep} ORDER BY reporter, basket_id, month) TO '{out / 'comext_importer.parquet'}' (FORMAT parquet)"
    )
    con.execute(
        f"COPY (SELECT supplier.* EXCLUDE (partner_code, share, share_12m) FROM supplier {keep} ORDER BY reporter, basket_id, month, value_eur DESC) TO '{out / 'comext_supplier.parquet'}' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 19)"
    )
    months = con.sql("SELECT min(month), max(month) FROM coverage WHERE complete").fetchall()[0]
    by_reporter = dict(
        con.sql("SELECT reporter, strftime(max(month), '%Y-%m-%d') FROM coverage WHERE complete GROUP BY 1").fetchall()
    )
    incomplete = con.sql("""
        SELECT reporter, strftime(month, '%Y-%m'), round(intra_vs_usual, 3), round(extra_vs_usual, 3)
        FROM coverage WHERE NOT complete ORDER BY 1, 2""").fetchall()
    stamp = con.sql("SELECT max(last_update) FROM raw").fetchall()[0][0]
    info = {
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": "Eurostat, Comext dataset DS-045409 (EU trade by HS6), © European Union; adapted by TradeGraph AI",
        "eurostat_last_update": stamp,
        "first_month": str(months[0]),
        "latest_month": str(months[1]),
        "latest_month_by_reporter": by_reporter,
        "reporters": cfg.comext.reporters + ["EU27_2020_EXTRA"],
        "units": {"value": "EUR", "quantity": "100 kg"},
        "unmapped_partner_codes": [{"code": c, "value_share": s} for c, s in unmapped],
        "min_month_coverage": MIN_MONTH_COVERAGE,
        "incomplete_months": [
            {"reporter": r, "month": m, "intra_eu_records_vs_usual": a, "extra_eu_records_vs_usual": b}
            for r, m, a, b in incomplete
        ],
        "notes": [
            "Import values as declared by the reporting country (EU customs statistics), not reconciled like BACI.",
            "EU27_2020_EXTRA counts only partners outside the EU.",
            "Trailing-12-month figures need 12 months of data and start 11 months after the first month.",
            "Trailing-12-month values include partners with no record in the month itself (value_eur is then empty).",
            "comext_supplier holds values only; a share is the value over the reporter-basket-month total.",
            "Months Eurostat has only partly published are left out of both marts and listed under incomplete_months.",
        ],
    }
    (out / "comext_info.json").write_text(json.dumps(info, indent=1))
    log(
        f"comext marts -> {out}: months {months[0]} .. {months[1]}; unmapped partner codes: {len(unmapped)}; "
        f"incomplete months: {[(r, m) for r, m, *_ in incomplete]}"
    )
    return out
