"""Time-safe features for next-year link forecasting.

One row per recorded link (basket, year t, exporter -> importer). Features use only years t, t-1 and t-2.
The target ``value_next`` is the recorded value in t+1; NULL means the link was not recorded
in t+1. The main benchmark covers persistent links; disappearance is reported separately.

Inputs (DuckDB relations):
  links(basket_id, year, exporter, importer, value)          -- recorded flows, k USD
  cov(exporter, importer, year, ldist, contig, comlang, colony, cov_missing, rta)  -- may be empty
  nodes(basket_id, year, country, centrality)                -- observed centrality of year t only
  grav(basket_id, year, exporter, importer, expected)        -- gravity fit on data <= year (may be empty)
"""

from __future__ import annotations

import duckdb
import pandas as pd

BASE_FEATURES = [
    "lv0", "lv1", "has1", "lv2", "has2", "mean3", "growth",
    "share", "hhi", "n_sup", "limp", "lexp", "exp_wshare",
    "ldist", "contig", "comlang", "colony", "cov_missing", "rta",
]  # fmt: skip
GRAPH_FEATURES = ["c_exp", "c_imp", "lgrav"]

FEATURE_SQL = """
WITH imp AS (
  SELECT basket_id, year, importer, sum(value) AS imp_tot, count(*) AS n_sup,
         sum(value * value) / (sum(value) * sum(value)) AS hhi
  FROM links GROUP BY ALL
), ex AS (
  SELECT basket_id, year, exporter, sum(value) AS exp_tot FROM links GROUP BY ALL
), world AS (
  SELECT basket_id, year, sum(value) AS w FROM links GROUP BY ALL
)
SELECT t.basket_id, t.year, t.exporter, t.importer, t.value,
       ln(1 + t.value)                                   AS lv0,
       ln(1 + coalesce(p1.value, 0))                     AS lv1,
       (p1.value IS NOT NULL)::INT                       AS has1,
       ln(1 + coalesce(p2.value, 0))                     AS lv2,
       (p2.value IS NOT NULL)::INT                       AS has2,
       (ln(1 + t.value) + coalesce(ln(1 + p1.value), 0) + coalesce(ln(1 + p2.value), 0))
         / (1 + (p1.value IS NOT NULL)::INT + (p2.value IS NOT NULL)::INT) AS mean3,
       CASE WHEN p1.value IS NOT NULL THEN ln(1 + t.value) - ln(1 + p1.value) ELSE 0 END AS growth,
       t.value / imp.imp_tot                             AS share,
       imp.hhi, imp.n_sup,
       ln(1 + imp.imp_tot)                               AS limp,
       ln(1 + ex.exp_tot)                                AS lexp,
       ex.exp_tot / world.w                              AS exp_wshare,
       c.ldist, c.contig, c.comlang, c.colony, c.cov_missing, c.rta,
       ne.centrality                                     AS c_exp,
       ni.centrality                                     AS c_imp,
       ln(1 + g.expected)                                AS lgrav,
       nx.value                                          AS value_next
FROM links t
JOIN imp   ON imp.basket_id = t.basket_id AND imp.year = t.year AND imp.importer = t.importer
JOIN ex    ON ex.basket_id = t.basket_id AND ex.year = t.year AND ex.exporter = t.exporter
JOIN world ON world.basket_id = t.basket_id AND world.year = t.year
LEFT JOIN links p1 ON p1.basket_id = t.basket_id AND p1.exporter = t.exporter AND p1.importer = t.importer AND p1.year = t.year - 1
LEFT JOIN links p2 ON p2.basket_id = t.basket_id AND p2.exporter = t.exporter AND p2.importer = t.importer AND p2.year = t.year - 2
LEFT JOIN links nx ON nx.basket_id = t.basket_id AND nx.exporter = t.exporter AND nx.importer = t.importer AND nx.year = t.year + 1
LEFT JOIN cov c    ON c.exporter = t.exporter AND c.importer = t.importer AND c.year = t.year
LEFT JOIN nodes ne ON ne.basket_id = t.basket_id AND ne.year = t.year AND ne.country = t.exporter
LEFT JOIN nodes ni ON ni.basket_id = t.basket_id AND ni.year = t.year AND ni.country = t.importer
LEFT JOIN grav g   ON g.basket_id = t.basket_id AND g.year = t.year AND g.exporter = t.exporter AND g.importer = t.importer
ORDER BY t.basket_id, t.year, t.exporter, t.importer
"""


def build_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.execute(FEATURE_SQL).df()
