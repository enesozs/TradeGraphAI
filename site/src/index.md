---
title: Overview
toc: false
---

```js
import {CANVAS, communityColor, addDefs, arcPath, usd} from "./components/observatory.js";
import {prepareGeo, cname} from "./components/geo.js";
const info = FileAttachment("data/build_info.json").json();
const cx = FileAttachment("data/comext_info.json").json();
const fm = FileAttachment("data/forecast_metrics.json").json();
const world = FileAttachment("data/countries-110m.json").json();
const db = DuckDBClient.of({
  geo: FileAttachment("data/country_geo.parquet"),
  nodes: FileAttachment("data/network_nodes.parquet"),
  edges: FileAttachment("data/network_edges.parquet"),
  movers: FileAttachment("data/movers_supplier.parquet"),
  cimp: FileAttachment("data/comext_importer.parquet"),
  scen: FileAttachment("data/scenario_summary.parquet")
});
```

```js
const rows = (r) => Array.from(r, (d) => ({...d}));
const pct = (x, d = 0) => (x == null ? "–" : `${(100 * x).toFixed(d)}%`);
const geoRows = rows(await db.query(`SELECT iso3, iso_num, country_name FROM geo WHERE iso_num IS NOT NULL`));
const geo = prepareGeo(world, geoRows);
const nameOf = new Map(geoRows.map((d) => [d.iso3, cname(d.iso3, d.country_name)]));
const year = info.years.filter((y) => !info.provisional_years.includes(y)).at(-1);
const edges = rows(await db.query(`SELECT exporter_iso3 AS e, importer_iso3 AS i, value_kusd AS v FROM edges WHERE basket_id = 'integrated_circuits' AND year = ? ORDER BY v DESC LIMIT 140`, [year]));
const comm = new Map(rows(await db.query(`SELECT iso3, community, exports_kusd + imports_kusd AS t FROM nodes WHERE basket_id = 'integrated_circuits' AND year = ?`, [year])).map((d) => [d.iso3, d]));
// Headline numbers, computed from the marts (nothing hard-coded)
const euLi = rows(await db.query(`SELECT * FROM cimp WHERE reporter = 'EU27_2020_EXTRA' AND basket_id = 'li_ion_batteries' ORDER BY month DESC LIMIT 1`))[0];
const ree = rows(await db.query(`SELECT importer_iso3, start_share, end_share FROM movers WHERE basket_id = 'rare_earths_and_magnets' AND supplier_iso3 = 'CHN' AND importer_iso3 IN ('DEU', 'USA') ORDER BY importer_iso3`));
const scn = rows(await db.query(`SELECT * FROM scen WHERE basket_id = 'rare_earths_and_magnets' AND supplier_iso3 = 'CHN' AND shortfall = 0.5 AND capacity = 'central'`))[0];
const hold = fm.breakdown.holdout.pooled;
```

```js
function heroMap(width) {
  const height = Math.max(340, Math.round(width * 0.46));
  const proj = d3.geoEqualEarth().fitExtent([[0, 30], [width, height + 40]], {type: "Sphere"});
  const path = d3.geoPath(proj);
  const svg = d3.create("svg").attr("viewBox", [0, 0, width, height]).attr("width", "100%").attr("role", "img")
    .attr("aria-label", `The ${edges.length} largest integrated-circuit trade flows of ${year}, drawn between countries and coloured by trade community.`);
  const fx = addDefs(svg, "hero");
  svg.append("rect").attr("width", width).attr("height", height).attr("fill", CANVAS.bg);
  svg.append("path").attr("d", path(d3.geoGraticule10())).attr("fill", "none").attr("stroke", "#ffffff0d");
  svg.append("g").selectAll("path").data(geo.countries.features).join("path").attr("d", path).attr("fill", CANVAS.land).attr("stroke", CANVAS.landEdge).attr("stroke-width", 0.5);
  const maxV = d3.max(edges, (d) => d.v) ?? 1;
  const g = svg.append("g").attr("fill", "none").attr("filter", fx.glow).style("mix-blend-mode", "screen");
  for (const e of edges) {
    const a = geo.anchor.get(e.e), b = geo.anchor.get(e.i); if (!a || !b) continue;
    g.append("path").attr("d", arcPath(proj(a), proj(b), 0.2)).attr("stroke", communityColor(comm.get(e.e)?.community))
      .attr("stroke-width", 0.4 + 5 * Math.sqrt(e.v / maxV)).attr("stroke-opacity", 0.25 + 0.6 * Math.sqrt(e.v / maxV));
  }
  const tmax = d3.max(comm.values(), (d) => d.t) ?? 1;
  for (const [iso, d] of comm) {
    const ll = geo.anchor.get(iso); if (!ll || d.t < tmax * 0.01) continue;
    const [x, y] = proj(ll);
    svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 1.5 + 11 * Math.sqrt(d.t / tmax)).attr("fill", communityColor(d.community)).attr("filter", fx.glow).attr("fill-opacity", 0.9);
  }
  return svg.node();
}
```

<div class="hero">

```js
display(resize((width) => heroMap(width)));
```

<div class="hero-text">
  <h1>TradeGraph AI</h1>
  <p>How dependent is each country on a few suppliers, how is that changing, and who could step in if one falls short? An open, evidence-first trade-dependency explorer.</p>
</div>
</div>

<p class="muted">Map: the ${edges.length} largest integrated-circuit trade flows of ${year}, coloured by trade community. Statistical links between countries, not shipping routes.</p>

## Headlines from the data

<div class="grid grid-cols-3">
  <div class="card kpi headline">
    <div class="sub">EU imports of lithium-ion batteries from outside the EU</div>
    <div class="big">${pct(euLi?.top1_share_12m)} from ${nameOf.get(euLi?.top1_iso3_12m) ?? euLi?.top1_iso3_12m}</div>
    <div class="sub">12 months to ${euLi ? d3.utcFormat("%B %Y")(new Date(euLi.month)) : "–"} · <a href="./eu-monthly.html">EU monthly monitor →</a></div>
  </div>
  <div class="card kpi headline">
    <div class="sub">China's share of rare-earth & magnet imports, 2012–14 → 2021–23</div>
    <div class="big">${ree.map((d) => `${d.importer_iso3} ${pct(d.start_share)}→${pct(d.end_share)}`).join(" · ")}</div>
    <div class="sub">driven by permanent magnets · <a href="./findings.html">Findings →</a></div>
  </div>
  <div class="card kpi headline scenario">
    <div class="sub">SCENARIO: China delivers 50% less rare earths & magnets (${scn?.year} data)</div>
    <div class="big scen-ink">${usd(scn?.unmet_kusd)} unmet</div>
    <div class="sub">of ${usd(scn?.exposed_kusd)} exposed; range ${usd(scn?.mc_unmet_p5)}–${usd(scn?.mc_unmet_p95)} · <a href="./scenarios.html">Scenario studio →</a></div>
  </div>
</div>

<p class="muted">Forecast benchmark: "same as last year" stays hard to beat. On the ${fm.folds.find((f) => f.role === "holdout").target_year} holdout its value-weighted error was ${pct(hold.persistence.wape_usd, 1)}, vs ${pct(hold.gbm_graph.wape_usd, 1)} for gradient boosting with network features. <a href="./forecast.html">Forecast lab →</a></p>

## Explore

<div class="grid grid-cols-3">
  <div class="card module-card"><a class="title" href="./profile.html">Dependency profile</a><p>Who supplies a country with a product, how concentrated that is, by value and tonnes, 2012–2024, plus a quick exposure scenario.</p></div>
  <div class="card module-card"><a class="title" href="./movers.html">Biggest movers</a><p>Where concentration rose or fell most between 2012–14 and 2021–23.</p></div>
  <div class="card module-card"><a class="title" href="./eu-monthly.html">EU monthly monitor</a><p>Month-by-month supplier shares for the EU and six member states, to ${d3.utcFormat("%b %Y")(new Date(cx.latest_month))}.</p></div>
  <div class="card module-card"><a class="title" href="./map.html">Trade map</a><p>Flows on a map or globe, supplier-share and concentration maps, and a quick disruption preview.</p></div>
  <div class="card module-card"><a class="title" href="./network.html">Network</a><p>Trade communities and who sits at their centre, compared with what a gravity model predicts.</p></div>
  <div class="card module-card scenario"><a class="title" href="./scenarios.html">Scenario studio</a><p>Simulate a supplier shortfall: exposed, reallocated and unmet demand under stated capacity assumptions, with uncertainty ranges.</p></div>
</div>

## Data

<div class="fresh">
  <span><strong>CEPII BACI</strong> ${info.source.hs_revision} V${info.source.release}: annual, ${info.years[0]}–${info.years.at(-1)} (${info.provisional_years.join(", ")} provisional)</span>
  <span><strong>Eurostat Comext</strong> DS-045409: monthly, ${d3.utcFormat("%b %Y")(new Date(cx.first_month))}–${d3.utcFormat("%b %Y")(new Date(cx.latest_month))}</span>
  <span><strong>CEPII Gravity</strong> V202211: distance, borders, language, trade agreements</span>
  <span><a href="./methodology.html">Methodology →</a></span>
</div>
