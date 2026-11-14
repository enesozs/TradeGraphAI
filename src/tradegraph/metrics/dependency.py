"""Supplier-dependency metrics per (basket, year, importer).

Inputs (DuckDB relations):
  flows(year, exporter, importer, product_code, value_kusd, quantity_t)  -- all partners
  basket_codes(basket_id, product_code)
Outputs:
  mart_supplier : one row per (basket, year, importer, supplier)
  mart_importer : one row per (basket, year, importer)

Definitions (BLUEPRINT §6):
  share_value      = v(e->i) / sum over ALL suppliers e' of v(e'->i)
  hhi_value        = sum of share_value^2;  effective_suppliers = 1 / hhi_value
  redirectable     = supplier's basket exports to every destination other than this importer
                     (an observed upper bound, not an estimate of feasible substitution)
  share_tonnes     = computed only over flows with a recorded quantity; tonnes_coverage reports
                     the value share of those flows so the tonnes view is never silently partial.
"""

from __future__ import annotations

import duckdb

SUPPLIER_SQL = """
CREATE OR REPLACE TABLE basket_flows AS
SELECT b.basket_id, f.year, f.exporter, f.importer,
       sum(f.value_kusd) AS value_kusd,
       sum(f.quantity_t) AS quantity_t,                          -- NULLs ignored
       sum(CASE WHEN f.quantity_t IS NOT NULL THEN f.value_kusd ELSE 0 END) AS value_with_q_kusd
FROM {flows} f JOIN {basket_codes} b USING (product_code)
GROUP BY ALL;

CREATE OR REPLACE TABLE mart_supplier AS
WITH exp AS (  -- each supplier's total basket exports to the world
  SELECT basket_id, year, exporter, sum(value_kusd) AS exports_world_kusd
  FROM basket_flows GROUP BY ALL
)
SELECT bf.basket_id, bf.year, bf.importer, bf.exporter AS supplier,
       bf.value_kusd,
       bf.quantity_t,
       bf.value_kusd / sum(bf.value_kusd) OVER w                         AS share_value,
       bf.quantity_t / nullif(sum(bf.quantity_t) OVER w, 0)              AS share_tonnes,
       row_number() OVER (PARTITION BY bf.basket_id, bf.year, bf.importer
                          ORDER BY bf.value_kusd DESC, bf.exporter)       AS rank_value,
       exp.exports_world_kusd,
       exp.exports_world_kusd - bf.value_kusd                            AS redirectable_kusd
FROM basket_flows bf JOIN exp USING (basket_id, year, exporter)
WINDOW w AS (PARTITION BY bf.basket_id, bf.year, bf.importer);
"""

IMPORTER_SQL = """
CREATE OR REPLACE TABLE mart_importer AS
WITH cov AS (
  SELECT basket_id, year, importer,
         sum(value_with_q_kusd) / sum(value_kusd) AS tonnes_coverage
  FROM basket_flows GROUP BY ALL
)
SELECT s.basket_id, s.year, s.importer,
       sum(s.value_kusd)                                     AS imports_kusd,
       sum(s.quantity_t)                                     AS imports_t,
       count(*)                                              AS supplier_count,
       sum(s.share_value * s.share_value)                    AS hhi_value,
       1 / sum(s.share_value * s.share_value)                AS effective_suppliers,
       sum(s.share_tonnes * s.share_tonnes)                  AS hhi_tonnes,
       max(CASE WHEN s.rank_value = 1 THEN s.supplier END)   AS top1_supplier,
       max(CASE WHEN s.rank_value = 1 THEN s.share_value END) AS top1_share_value,
       sum(CASE WHEN s.rank_value <= 3 THEN s.share_value ELSE 0 END) AS top3_share_value,
       any_value(cov.tonnes_coverage)                        AS tonnes_coverage
FROM mart_supplier s JOIN cov USING (basket_id, year, importer)
GROUP BY s.basket_id, s.year, s.importer;
"""


def build(con: duckdb.DuckDBPyConnection, flows: str = "flows", basket_codes: str = "basket_codes") -> None:
    """Create mart_supplier and mart_importer in ``con``."""
    con.execute(SUPPLIER_SQL.format(flows=flows, basket_codes=basket_codes))
    con.execute(IMPORTER_SQL)


def direct_exposure(value_kusd: float, shortfall: float) -> float:
    """Scenario V1: exposed import value for an assumed shortfall fraction in [0, 1]."""
    if not 0.0 <= shortfall <= 1.0:
        raise ValueError("shortfall must be within [0, 1]")
    return value_kusd * shortfall
