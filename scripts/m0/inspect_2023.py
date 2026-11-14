import duckdb, sys
D = sys.argv[1]
con = duckdb.connect()
con.execute(f"""
CREATE VIEW f AS SELECT * FROM read_csv('{D}/BACI_HS12_Y2023_V202601.csv', header=true,
  columns={{'t':'INTEGER','i':'INTEGER','j':'INTEGER','k':'VARCHAR','v':'DOUBLE','q':'VARCHAR'}});
CREATE VIEW c AS SELECT * FROM read_csv('{D}/country_codes_V202601.csv', header=true, all_varchar=true);
""")
def q(title, sql):
    print(f"\n== {title}"); print(con.sql(sql))
q("raw q text values that are not numeric (top)", "SELECT q, count(*) n FROM f WHERE TRY_CAST(trim(q) AS DOUBLE) IS NULL GROUP BY 1 ORDER BY n DESC LIMIT 5")
con.execute("CREATE VIEW g AS SELECT t,i,j,k,v, TRY_CAST(trim(q) AS DOUBLE) AS qn FROM f")
q("shape & basic integrity", """SELECT count(*) rows, count(DISTINCT i) exporters, count(DISTINCT j) importers,
  count(DISTINCT k) products, min(t) tmin, max(t) tmax, sum(v)/1e6 AS total_bn_usd,
  sum(CASE WHEN v<=0 THEN 1 ELSE 0 END) nonpos_v, sum(CASE WHEN qn IS NULL THEN 1 ELSE 0 END) q_missing,
  round(100.0*sum(CASE WHEN qn IS NULL THEN 1 ELSE 0 END)/count(*),2) q_missing_pct,
  sum(CASE WHEN i=j THEN 1 ELSE 0 END) self_flows, min(length(k)) kmin, max(length(k)) kmax FROM g""")
q("duplicate keys", "SELECT count(*) dup_groups FROM (SELECT t,i,j,k FROM g GROUP BY ALL HAVING count(*)>1)")
q("smallest values (k USD)", "SELECT v, count(*) n FROM g GROUP BY v ORDER BY v LIMIT 5")
q("value distribution (k USD)", "SELECT quantile_cont(v,[0.01,0.25,0.5,0.75,0.99]) qs FROM g")
q("codes not in country file", "SELECT DISTINCT x FROM (SELECT i x FROM g UNION SELECT j FROM g) WHERE CAST(x AS VARCHAR) NOT IN (SELECT country_code FROM c)")
q("special codes present (490 Other Asia nes)", "SELECT i, round(sum(v)/1e6,1) exports_bn FROM g WHERE i IN (490,697) GROUP BY i")
