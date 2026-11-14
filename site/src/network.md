---
title: Network
---


# Who sits at the centre of each product network?

```js
import {CANVAS, communityColor, addDefs, background, tag, arcPath} from "./components/observatory.js";
const info = FileAttachment("data/build_info.json").json();
const fitInfo = FileAttachment("data/gravity_fit.json").json();
const db = DuckDBClient.of({
  nodes: FileAttachment("data/network_nodes.parquet"),
  edges: FileAttachment("data/network_edges.parquet")
});
const NAME_OVERRIDE = {S19: "Other Asia, nes (incl. Taiwan)"};
const cname = (iso3, name) => NAME_OVERRIDE[iso3] ?? name;
const usd = (k) => { const v = k * 1e3; return v >= 1e9 ? `$${(v / 1e9).toFixed(1)} bn` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)} m` : `$${(v / 1e3).toFixed(0)} k`; };
const rows = (r) => Array.from(r, (d) => ({...d}));
const ratioFmt = (x) => (x == null || !isFinite(x) ? "–" : `${x.toFixed(2)}×`);
```

```js
const labelOf = new Map(info.baskets.map((b) => [b.id, b.label]));
const basketId = view(Inputs.select(info.baskets.map((b) => b.id), {label: "Product basket", format: (id) => labelOf.get(id)}));
const finalYears = info.years.filter((y) => !info.provisional_years.includes(y));
const year = view(Inputs.select(info.years, {label: "Year", value: finalYears.at(-1), format: (y) => (info.provisional_years.includes(y) ? `${y} (provisional)` : String(y))}));
const topN = view(Inputs.range([20, 250], {label: "Largest links shown", step: 10, value: 150}));
const colorBy = view(Inputs.radio(["Trade community", "Relative to gravity"], {label: "Colour", value: "Trade community"}));
```

<div class="chips">
  <span class="chip obs">OBSERVED network</span>
  <span class="chip model">MODEL baseline: gravity (PPML)</span>
  <span class="chip">CEPII BACI ${info.source.hs_revision} V${info.source.release} · CEPII Gravity</span>
</div>

<p class="muted">Arrows point from exporter to importer, and line width shows the value of recorded trade. These are statistical links, not shipping routes. <strong>Centrality</strong> (PageRank on the supplier side) is high when a country supplies large shares to importers that are themselves central. <strong>Relative to gravity</strong> compares that with what a gravity model predicts from distance, shared borders, language, colonial ties, trade agreements and each country's overall size in this basket. A ratio above 1 means more central than geography and size alone would suggest.</p>

```js
const nodes = rows(await db.query(`SELECT * FROM nodes WHERE basket_id = ? AND year = ?`, [basketId, year]))
  .map((d) => ({...d, name: cname(d.iso3, d.country_name), ratio: d.centrality_expected > 0 ? d.centrality / d.centrality_expected : null}));
const edgesAll = rows(await db.query(`SELECT * FROM edges WHERE basket_id = ? AND year = ? ORDER BY value_kusd DESC`, [basketId, year]));
const edges = edgesAll.slice(0, topN);
const byIso = new Map(nodes.map((d) => [d.iso3, d]));
```

```js
function networkChart(width) {
  const height = Math.round(Math.min(760, Math.max(460, width * 0.62)));
  const ns = nodes.filter((d) => d.community >= 0 && d.exports_kusd + d.imports_kusd > 0).map((d) => ({id: d.iso3, ...d}));
  const inGraph = new Set(ns.map((d) => d.id));
  const ls = edges.filter((e) => inGraph.has(e.exporter_iso3) && inGraph.has(e.importer_iso3)).map((e) => ({source: e.exporter_iso3, target: e.importer_iso3, value: e.value_kusd}));
  const maxV = d3.max(ls, (d) => d.value) ?? 1;
  const tradeOf = (d) => d.exports_kusd + d.imports_kusd;
  const size = d3.scaleSqrt().domain([0, d3.max(ns, tradeOf) ?? 1]).range([1.6, 24]);
  // Community anchors spread around an ellipse (largest community first), so clusters separate visibly.
  const comms = d3.sort(new Set(ns.map((d) => d.community)), (c) => c);
  const anchorOf = new Map(comms.map((c, i) => {
    const a = (i / Math.max(1, comms.length)) * 2 * Math.PI - Math.PI / 2;
    const r = comms.length > 1 ? 0.33 : 0;
    return [c, [width / 2 + Math.cos(a) * width * r, height / 2 + Math.sin(a) * height * r]];
  }));
  const sim = d3.forceSimulation(ns)
    .force("link", d3.forceLink(ls).id((d) => d.id).distance(40).strength((l) => (l.source.community === l.target.community ? 0.12 : 0)))
    .force("charge", d3.forceManyBody().strength(-14))
    .force("x", d3.forceX((d) => anchorOf.get(d.community)[0]).strength(0.5))
    .force("y", d3.forceY((d) => anchorOf.get(d.community)[1]).strength(0.5))
    .force("collide", d3.forceCollide((d) => size(tradeOf(d)) + 2))
    .stop();
  for (let i = 0; i < 500; ++i) sim.tick(); // static layout: deterministic, no animation
  const pad = 46, [x0, x1] = d3.extent(ns, (d) => d.x), [y0, y1] = d3.extent(ns, (d) => d.y);
  const k = Math.min((width - 2 * pad) / Math.max(1, x1 - x0), (height - 2 * pad) / Math.max(1, y1 - y0));
  for (const d of ns) { d.x = pad + (d.x - x0) * k + ((width - 2 * pad) - (x1 - x0) * k) / 2; d.y = pad + (d.y - y0) * k + ((height - 2 * pad) - (y1 - y0) * k) / 2; }

  const div = d3.scaleDiverging([-2, 0, 2], d3.interpolateRdBu).unknown("#6c7a80");
  const fill = (d) => (colorBy === "Trade community" ? communityColor(d.community) : div(Math.log2(d.ratio ?? 1)));
  const w = d3.scaleSqrt([0, maxV], [0.3, 5]);
  const svg = d3.create("svg").attr("class", "net").attr("viewBox", [0, 0, width, height]).attr("role", "img")
    .attr("aria-label", `Trade network of ${labelOf.get(basketId)} in ${year}: ${ns.length} trading countries in ${comms.length} trade communities, ${ls.length} largest links. Full numbers in the tables below.`);
  const fx = addDefs(svg, "net");
  background(svg, width, height, 72);
  svg.append("g").attr("fill", "none").attr("filter", fx.glow).style("mix-blend-mode", "screen").selectAll("path").data(ls).join("path")
    .attr("d", (d) => arcPath([d.source.x, d.source.y], [d.target.x, d.target.y], 0.12))
    .attr("stroke", (d) => (colorBy === "Trade community" ? communityColor(d.source.community) : "#9fb0b8"))
    .attr("stroke-opacity", (d) => 0.18 + 0.6 * Math.sqrt(d.value / maxV)).attr("stroke-width", (d) => w(d.value))
    .append("title").text((d) => `${d.source.name} → ${d.target.name}: ${usd(d.value)}`);
  const g = svg.append("g").selectAll("g").data(ns).join("g").attr("transform", (d) => `translate(${d.x},${d.y})`);
  g.append("circle").attr("r", (d) => size(tradeOf(d))).attr("fill", fill).attr("fill-opacity", 0.9).attr("filter", fx.glow)
    .attr("stroke", CANVAS.bg).attr("stroke-width", 0.8)
    .append("title").text((d) => `${d.name} · community ${d.community + 1}\nExports ${usd(d.exports_kusd)} · Imports ${usd(d.imports_kusd)}\nCentrality ${(100 * d.centrality).toFixed(1)}% · vs gravity ${ratioFmt(d.ratio)}`);
  const labelled = new Set(d3.sort(ns, (d) => -tradeOf(d)).slice(0, 16).map((d) => d.id));
  g.filter((d) => labelled.has(d.id)).append("text").attr("dy", (d) => size(tradeOf(d)) + 11).attr("text-anchor", "middle")
    .attr("fill", CANVAS.muted).attr("font-size", 10.5).attr("font-family", "var(--sans-serif)").text((d) => d.id);
  // Community tags: "<largest member> cluster · total trade"
  if (colorBy === "Trade community") {
    for (const [c, members] of d3.group(ns, (d) => d.community)) {
      if (c < 0 || members.length < 2) continue;
      const head = d3.greatest(members, tradeOf);
      const cx = d3.mean(members, (d) => d.x), cy = d3.min(members, (d) => d.y) - 18;
      const text = `${head.id} cluster · ${members.length} · ${usd(d3.sum(members, (d) => d.exports_kusd))} exports`;
      const tw = text.length * 6.6 + 12;
      tag(svg, Math.max(4, Math.min(width - tw - 4, cx - tw / 2)), Math.max(16, cy), text, communityColor(c));
    }
  }
  return svg.node();
}
```

<div class="card observatory">

### ${labelOf.get(basketId)} · ${year}

<span class="muted">All ${nodes.filter((d) => d.community >= 0).length} trading countries, with the ${edges.length} largest recorded links drawn. Node size shows the country's trade in this basket. ${colorBy === "Trade community" ? "Colour: trade communities, groups of countries that trade intensely with each other (Louvain algorithm). These are algorithmic groupings, not political blocs. Link colour follows the exporter's community." : "Colour: blue = more central as a supplier than gravity predicts, red = less, grey = no gravity estimate."} Positions are a layout, not geography; see the Map page for that.</span>

```js
if (colorBy === "Relative to gravity") display(Plot.legend({color: {type: "diverging", scheme: "RdBu", domain: [-2, 2], pivot: 0, label: "Centrality ÷ gravity-expected centrality", tickFormat: (d) => `×${(2 ** d).toFixed(d < 0 ? 2 : 0)}`, ticks: [-2, -1, 0, 1, 2]}}));
display(resize((width) => networkChart(Math.max(width, 320))));
```

</div>

```js
const nodeTable = d3.sort(nodes, (d) => -d.centrality).map((d, i) => ({
  Rank: i + 1, Country: d.name, ISO3: d.iso3,
  "Exports (k USD)": d.exports_kusd, "Imports (k USD)": d.imports_kusd,
  "Centrality": d.centrality, "Gravity-expected centrality": d.centrality_expected, "Centrality vs gravity": d.ratio
}));
const fmt0 = (x) => (x == null ? "–" : Math.round(x).toLocaleString("en-US"));
const pctc = (x) => (x == null ? "–" : `${(100 * x).toFixed(2)}%`);
```

<div class="grid grid-cols-2">
<div class="card">

### Countries by supplier centrality

<span class="muted">Each country's total exports and imports are reproduced exactly by the gravity model (a property of PPML with country-year effects). The comparison that carries information is <em>who trades with whom</em>, which is what centrality vs gravity measures.</span>

```js
display(Inputs.table(nodeTable, {rows: 12, layout: "auto", format: {
  "Exports (k USD)": fmt0, "Imports (k USD)": fmt0, "Centrality": pctc, "Gravity-expected centrality": pctc, "Centrality vs gravity": ratioFmt
}}));
```

</div>
<div class="card">

### Largest links

```js
display(Inputs.table(edgesAll.slice(0, 250).map((e) => ({
  Exporter: cname(e.exporter_iso3, byIso.get(e.exporter_iso3)?.country_name ?? e.exporter_iso3),
  Importer: cname(e.importer_iso3, byIso.get(e.importer_iso3)?.country_name ?? e.importer_iso3),
  "Value (k USD)": e.value_kusd, "Gravity-expected (k USD)": e.expected_kusd,
  "Observed ÷ expected": e.expected_kusd > 0 ? e.value_kusd / e.expected_kusd : null
})), {rows: 12, layout: "auto", format: {"Value (k USD)": fmt0, "Gravity-expected (k USD)": fmt0, "Observed ÷ expected": ratioFmt}}));
```

</div>
</div>

```js
const f = fitInfo.baskets[basketId];
const names = {ldist: "log distance", contig: "shared border", comlang: "common official language", colony: "colonial tie (ever)", rta: "trade agreement in force", cov_missing: "covariate imputed (indicator)"};
const coefRows = Object.entries(f.main.coefficients).map(([k, v]) => ({
  Variable: names[k] ?? k, Estimate: v.estimate, "Std. error": v.se,
  "Effect on expected trade": k === "ldist" ? `1% farther → ${v.estimate.toFixed(2)}%` : `×${Math.exp(v.estimate).toFixed(2)}`,
  "Robustness run": f.robustness_drop_smallest.coefficients[k]?.estimate
}));
```

<div class="card">

### Gravity model for this basket

<span class="muted">PPML with exporter-year and importer-year fixed effects, on ${f.main.n_obs.toLocaleString("en-US")} country-pair-years, 2012–2024. <strong>Modelling assumption:</strong> inside this model only, country pairs with no recorded trade count as zero, which PPML requires. ${f.main.n_rows_without_covariates.toLocaleString("en-US")} pair-years involve entities with no gravity covariates and are left out. Where CEPII leaves a border, language or colonial-tie value missing, it's filled from the reverse pair or set to 0 and flagged. The robustness run drops the smallest ${Math.round(100 * f.robustness_drop_smallest.share_excluded)}% of economies; correlation of gravity-expected supplier shares with the main run: <strong>${f.robustness_drop_smallest.corr_expected_shares_vs_main?.toFixed(3) ?? "–"}</strong>.</span>

```js
display(Inputs.table(coefRows, {layout: "auto", format: {Estimate: (x) => x.toFixed(3), "Std. error": (x) => x.toFixed(3), "Robustness run": (x) => (x == null ? "–" : x.toFixed(3))}}));
```

<span class="muted">Coefficients describe average associations in this basket's trade. They are not causal effects. Trade-agreement status after ${fitInfo.covariates.includes("True") ? "2021 is carried forward from 2021, so agreements that started later (e.g. RCEP in 2022) are not captured" : "the last covariate year is not extended"}.</span>

</div>
