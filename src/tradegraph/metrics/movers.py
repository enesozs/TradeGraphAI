"""'Biggest movers': how dependency changed between two multi-year windows.

Inputs: mart_importer, mart_supplier (from tradegraph.metrics.dependency.build).
Outputs:
  movers_importer : per (basket, importer). Window-average HHI, top-1 share and imports, plus deltas.
                    Kept only when the importer has data in EVERY year of both windows and averages
                    at least ``min_imports_kusd`` of imports per year in both windows.
  movers_supplier : per (basket, importer, supplier), for the importers kept above.
                    Window-average share of the importer's imports. A year without a recorded flow
                    counts as share 0 for that supplier (its share of RECORDED imports);
                    years_present_* says how many years actually had a flow.
"""

from __future__ import annotations

import duckdb

SQL = """
CREATE OR REPLACE TABLE movers_importer AS
WITH w AS (
  SELECT *, CASE WHEN year BETWEEN {s0} AND {s1} THEN 'start'
                 WHEN year BETWEEN {e0} AND {e1} THEN 'end' END AS win
  FROM mart_importer
), agg AS (
  SELECT basket_id, importer, win,
         count(*) AS n_years, avg(hhi_value) AS hhi, avg(top1_share_value) AS top1, avg(imports_kusd) AS imports
  FROM w WHERE win IS NOT NULL GROUP BY ALL
)
SELECT s.basket_id, s.importer,
       s.imports AS start_imports_kusd, e.imports AS end_imports_kusd,
       s.hhi AS start_hhi, e.hhi AS end_hhi, e.hhi - s.hhi AS delta_hhi,
       s.top1 AS start_top1_share, e.top1 AS end_top1_share, e.top1 - s.top1 AS delta_top1_share
FROM agg s JOIN agg e USING (basket_id, importer)
WHERE s.win = 'start' AND e.win = 'end'
  AND s.n_years = {s1} - {s0} + 1 AND e.n_years = {e1} - {e0} + 1
  AND s.imports >= {min_imports} AND e.imports >= {min_imports};

CREATE OR REPLACE TABLE movers_supplier AS
WITH w AS (
  SELECT m.*, CASE WHEN m.year BETWEEN {s0} AND {s1} THEN 'start' ELSE 'end' END AS win
  FROM mart_supplier m
  JOIN movers_importer k USING (basket_id, importer)
  WHERE m.year BETWEEN {s0} AND {s1} OR m.year BETWEEN {e0} AND {e1}
), agg AS (
  SELECT basket_id, importer, supplier,
         sum(CASE WHEN win = 'start' THEN share_value ELSE 0 END) / ({s1} - {s0} + 1) AS start_share,
         sum(CASE WHEN win = 'end' THEN share_value ELSE 0 END) / ({e1} - {e0} + 1)   AS end_share,
         count(*) FILTER (WHERE win = 'start') AS years_present_start,
         count(*) FILTER (WHERE win = 'end')   AS years_present_end
  FROM w GROUP BY ALL
)
SELECT *, end_share - start_share AS delta_share FROM agg;
"""


def build(
    con: duckdb.DuckDBPyConnection,
    start_years: tuple[int, int],
    end_years: tuple[int, int],
    min_imports_kusd: float,
) -> None:
    con.execute(
        SQL.format(
            s0=int(start_years[0]),
            s1=int(start_years[1]),
            e0=int(end_years[0]),
            e1=int(end_years[1]),
            min_imports=float(min_imports_kusd),
        )
    )
