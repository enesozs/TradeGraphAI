import duckdb, json, sys
D, OUT = sys.argv[1], sys.argv[2]
con = duckdb.connect()
con.execute(f"""
CREATE TABLE g AS SELECT i,j,k,v, TRY_CAST(trim(q) AS DOUBLE) qn FROM read_csv('{D}/BACI_HS12_Y2023_V202601.csv', header=true,
  columns={{'t':'INTEGER','i':'INTEGER','j':'INTEGER','k':'VARCHAR','v':'DOUBLE','q':'VARCHAR'}});
CREATE TABLE c AS SELECT CAST(country_code AS INTEGER) code, country_iso3 iso3, country_name name FROM read_csv('{D}/country_codes_V202601.csv', header=true, all_varchar=true);
CREATE TABLE b(basket VARCHAR, label VARCHAR, k VARCHAR);
INSERT INTO b VALUES
 ('ics','Integrated circuits','854231'),('ics','Integrated circuits','854232'),('ics','Integrated circuits','854233'),('ics','Integrated circuits','854239'),
 ('liion','Li-ion accumulators','850760'),('lichem','Lithium chemicals','283691'),('lichem','Lithium chemicals','282520'),
 ('ree','Rare earths & magnets','280530'),('ree','Rare earths & magnets','284610'),('ree','Rare earths & magnets','284690'),('ree','Rare earths & magnets','850511'),
 ('abx','Antibiotics (bulk)','294110'),('abx','Antibiotics (bulk)','294120'),('abx','Antibiotics (bulk)','294130'),('abx','Antibiotics (bulk)','294140'),('abx','Antibiotics (bulk)','294150'),('abx','Antibiotics (bulk)','294190'),
 ('coffee','Green coffee (control)','090111');
CREATE TABLE gb AS SELECT b.basket, b.label, g.* FROM g JOIN b USING (k);
CREATE TABLE imp AS
 WITH m AS (SELECT basket, j, i, sum(v) v FROM gb GROUP BY ALL),
 s AS (SELECT *, v/sum(v) OVER (PARTITION BY basket,j) sh, row_number() OVER (PARTITION BY basket,j ORDER BY v DESC) r FROM m)
 SELECT basket, j, sum(v) imports, count(*) suppliers, sum(sh*sh) hhi, max(CASE WHEN r=1 THEN sh END) top1,
   max(CASE WHEN r=1 THEN i END) top1_code FROM s GROUP BY ALL;
""")
res = {"source": "CEPII BACI HS12 V202601, year 2023 (provisional-year rule: 2024 is the provisional year in this release)",
       "world_total_kusd": con.sql("SELECT sum(v) FROM g").fetchall()[0][0], "baskets": []}
for (bk, label) in con.sql("SELECT DISTINCT basket, label FROM b ORDER BY 1").fetchall():
    summ = con.sql(f"""SELECT sum(v), count(*), count(DISTINCT i), count(DISTINCT j), avg(CASE WHEN qn IS NULL THEN 1.0 ELSE 0 END)
                       FROM gb WHERE basket='{bk}'""").fetchall()[0]
    top_exp = con.sql(f"""SELECT c.iso3, c.name, sum(v) v FROM gb JOIN c ON c.code=gb.i WHERE basket='{bk}' GROUP BY ALL ORDER BY v DESC LIMIT 8""").fetchall()
    # importer concentration buckets, weighting by import value
    buckets = con.sql(f"""SELECT CASE WHEN hhi<0.15 THEN 'diversified (<0.15)' WHEN hhi<0.25 THEN 'moderate (0.15–0.25)' ELSE 'concentrated (≥0.25)' END b,
        count(*) n, sum(imports) val FROM imp WHERE basket='{bk}' GROUP BY 1""").fetchall()
    focal = con.sql(f"""SELECT cj.iso3, imports, suppliers, hhi, top1, ci.iso3 FROM imp JOIN c cj ON cj.code=imp.j JOIN c ci ON ci.code=imp.top1_code
        WHERE basket='{bk}' AND cj.iso3 IN ('USA','DEU','JPN','IND','FRA','KOR','BRA','GBR') ORDER BY imports DESC""").fetchall()
    res["baskets"].append({"id": bk, "label": label, "world_kusd": summ[0], "rows": summ[1], "exporters": summ[2], "importers": summ[3],
        "q_missing_share": summ[4], "top_exporters": [{"iso3": a, "name": n, "kusd": v} for a, n, v in top_exp],
        "hhi_buckets": [{"bucket": a, "importers": n, "kusd": v} for a, n, v in buckets],
        "focal": [{"iso3": a, "kusd": v, "suppliers": s, "hhi": h, "top1": t, "top1_iso3": t3} for a, v, s, h, t, t3 in focal]})
json.dump(res, open(OUT, "w"), indent=1)
print("ok", OUT)
