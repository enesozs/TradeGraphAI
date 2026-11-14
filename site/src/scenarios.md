---
title: Scenario studio
---

# Scenario studio: what if a major supplier falls short?

```js
import {CANVAS, addDefs, arcPath, usd} from "./components/observatory.js";
import {prepareGeo, cname} from "./components/geo.js";
const info = FileAttachment("data/build_info.json").json();
const world = FileAttachment("data/countries-110m.json").json();
const db = DuckDBClient.of({
  summary: FileAttachment("data/scenario_summary.parquet"),
  imp: FileAttachment("data/scenario_importer.parquet"),
  mc: FileAttachment("data/scenario_mc_importer.parquet"),
  flows: FileAttachment("data/scenario_flows.parquet"),
  geo: FileAttachment("data/country_geo.parquet")
});
```

```js
const rows = (r) => Array.from(r, (d) => ({...d}));
const pct = (x) => (x == null || isNaN(x) ? "–" : `${(100 * x).toFixed(1)}%`);
const geoRows = rows(await db.query(`SELECT iso3, iso_num, country_name FROM geo WHERE iso_num IS NOT NULL`));
const nameOf = new Map(geoRows.map((d) => [d.iso3, cname(d.iso3, d.country_name)]));
const geo = prepareGeo(world, geoRows);
const labelOf = new Map(info.baskets.map((b) => [b.id, b.label]));
const CAP = {Low: "low", Central: "central", High: "high"};
const CAP_TEXT = {low: "5% of each alternative supplier's exports can be diverted; no new trade links", central: "15% can be diverted; new links allowed at half priority", high: "30% can be diverted; new links allowed at half priority"};
```

```js
const basketId = view(Inputs.select(info.baskets.map((b) => b.id), {label: "Product basket", format: (id) => labelOf.get(id), value: "rare_earths_and_magnets"}));
```

```js
const suppliers = rows(await db.query(`SELECT DISTINCT supplier_iso3 AS iso3, any_value(exposed_kusd) AS e FROM summary WHERE basket_id = ? AND shortfall = 1.0 AND capacity = 'central' GROUP BY 1 ORDER BY e DESC`, [basketId]));
```

```js
const supplier = view(Inputs.select(suppliers.map((d) => d.iso3), {label: "Supplier that falls short", format: (c) => nameOf.get(c) ?? c, value: suppliers[0]?.iso3}));
const shortfall = view(Inputs.radio([0.25, 0.5, 0.75, 1.0], {label: "Assumed shortfall", format: (x) => `${x * 100}%`, value: 0.5}));
const capacityLabel = view(Inputs.radio(Object.keys(CAP), {label: "Capacity assumption", value: "Central"}));
```

```js
const capacity = CAP[capacityLabel];
const sum = rows(await db.query(`SELECT * FROM summary WHERE basket_id = ? AND supplier_iso3 = ? AND shortfall = ?`, [basketId, supplier, shortfall]));
const S = sum.find((d) => d.capacity === capacity);
const impRows = rows(await db.query(`SELECT i.*, m.unmet_share_p5, m.unmet_share_p50, m.unmet_share_p95 FROM imp i
  LEFT JOIN mc m ON m.basket_id = i.basket_id AND m.supplier_iso3 = i.supplier_iso3 AND m.shortfall = i.shortfall AND m.importer_iso3 = i.importer_iso3
  WHERE i.basket_id = ? AND i.supplier_iso3 = ? AND i.shortfall = ? AND i.capacity = ? ORDER BY i.unmet_kusd DESC`, [basketId, supplier, shortfall, capacity]));
const flowRows = rows(await db.query(`SELECT * FROM flows WHERE basket_id = ? AND supplier_iso3 = ? AND shortfall = ? AND capacity = ? ORDER BY reallocated_kusd DESC LIMIT 30`, [basketId, supplier, shortfall, capacity]));
const hasMC = S?.mc_unmet_p5 != null;
```

<div class="chips">
  <span class="chip scen">SCENARIO · assumed ${shortfall * 100}% shortfall from ${nameOf.get(supplier) ?? supplier}</span>
  <span class="chip">Capacity: ${capacityLabel}</span>
  <span class="chip">Base data: CEPII BACI ${info.source.hs_revision} V${info.source.release}, ${S?.year ?? ""}</span>
</div>

<div class="grid grid-cols-4">
  <div class="card kpi"><div class="sub">Imports directly exposed</div><div class="big scen-ink">${usd(S?.exposed_kusd)}</div><div class="sub">${S?.n_importers ?? "–"} importers buy from ${supplier}</div></div>
  <div class="card kpi"><div class="sub">Reallocated by other suppliers</div><div class="big">${usd(S?.reallocated_kusd)}</div><div class="sub">${S?.n_alternatives_used ?? "–"} alternative suppliers used</div></div>
  <div class="card kpi"><div class="sub">Unmet demand</div><div class="big scen-ink">${usd(S?.unmet_kusd)}</div><div class="sub">${S ? pct(S.unmet_kusd / S.exposed_kusd) : "–"} of the exposed value</div></div>
  <div class="card kpi"><div class="sub">Unmet, uncertainty range</div><div class="big">${hasMC ? `${usd(S.mc_unmet_p5)} – ${usd(S.mc_unmet_p95)}` : "–"}</div><div class="sub">${hasMC ? "5th–95th percentile over 100 random capacity draws" : "Monte Carlo run for 50% and 100% shortfalls"}</div></div>
</div>

```js
function scenarioMap(width) {
  const height = Math.round(width * 0.52);
  const proj = d3.geoEqualEarth().fitExtent([[6, 6], [width - 6, height - 6]], {type: "Sphere"});
  const path = d3.geoPath(proj);
  const svg = d3.create("svg").attr("class", "map").attr("viewBox", [0, 0, width, height]).attr("role", "img")
    .attr("aria-label", `Scenario map: ${shortfall * 100}% shortfall of ${labelOf.get(basketId)} from ${nameOf.get(supplier)}. Countries shaded by unmet demand as a share of their imports. Exact numbers in the tables below.`);
  const fx = addDefs(svg, "scn");
  svg.append("rect").attr("width", width).attr("height", height).attr("fill", CANVAS.bg);
  svg.append("path").attr("d", path({type: "Sphere"})).attr("fill", CANVAS.ocean).attr("stroke", "#ffffff22");
  svg.append("path").attr("d", path(d3.geoGraticule10())).attr("fill", "none").attr("stroke", "#ffffff10");
  const byImp = new Map(impRows.map((d) => [d.importer_iso3, d]));
  const color = d3.scaleSequentialSqrt([0, Math.max(0.05, d3.max(impRows, (d) => d.unmet_share) ?? 0)], d3.interpolateRgb("#24343d", "#ffb84d"));
  svg.append("g").selectAll("path").data(geo.countries.features).join("path").attr("d", path)
    .attr("fill", (f) => { const g = geo.byNum.get(f.id); const r = g && byImp.get(g.iso3); return g?.iso3 === supplier ? "#5a4a2a" : r ? color(r.unmet_share) : CANVAS.land; })
    .append("title").text((f) => {
      const g = geo.byNum.get(f.id); if (!g) return f.properties.name;
      if (g.iso3 === supplier) return `${nameOf.get(g.iso3)}: supplier assumed to fall short`;
      const r = byImp.get(g.iso3);
      return r ? `${nameOf.get(g.iso3)} (SCENARIO)\nExposed ${usd(r.exposed_kusd)} · reallocated ${usd(r.reallocated_kusd)} · unmet ${usd(r.unmet_kusd)}\nUnmet = ${pct(r.unmet_share)} of its imports` : `${nameOf.get(g.iso3)}: not supplied by ${supplier}`;
    });
  svg.append("path").attr("d", path(geo.borders)).attr("fill", "none").attr("stroke", CANVAS.landEdge).attr("stroke-width", 0.6);
  const from = geo.anchor.get(supplier);
  const g = svg.append("g").attr("fill", "none").attr("stroke-linecap", "round").attr("filter", fx.glow).style("mix-blend-mode", "screen");
  // Lost supply: supplier -> importers (amber, dashed), width by exposed value
  const topLost = impRows.slice().sort((a, b) => b.exposed_kusd - a.exposed_kusd).slice(0, 40);
  const wl = d3.scaleSqrt([0, d3.max(topLost, (d) => d.exposed_kusd) ?? 1], [0.6, 6]);
  for (const r of topLost) {
    const to = geo.anchor.get(r.importer_iso3); if (!from || !to) continue;
    g.append("path").attr("d", arcPath(proj(from), proj(to), 0.2)).attr("stroke", "#ffb84d").attr("stroke-dasharray", "6,4")
      .attr("stroke-width", wl(r.exposed_kusd)).attr("stroke-opacity", 0.8)
      .append("title").text(`Lost supply ${supplier} → ${r.importer_iso3}: ${usd(r.exposed_kusd)} (SCENARIO)`);
  }
  // Reallocation: alternative -> importer (teal), width by reallocated value
  const wr = d3.scaleSqrt([0, d3.max(flowRows, (d) => d.reallocated_kusd) ?? 1], [0.6, 5]);
  for (const r of flowRows) {
    const a = geo.anchor.get(r.alternative_iso3), b = geo.anchor.get(r.importer_iso3); if (!a || !b) continue;
    g.append("path").attr("d", arcPath(proj(a), proj(b), -0.18)).attr("stroke", "#4dd4ac").attr("stroke-width", wr(r.reallocated_kusd))
      .attr("stroke-opacity", r.existing_link ? 0.85 : 0.45).attr("stroke-dasharray", r.existing_link ? null : "2,3")
      .append("title").text(`Reallocated ${r.alternative_iso3} → ${r.importer_iso3}: ${usd(r.reallocated_kusd)}${r.existing_link ? "" : " (new link)"} (SCENARIO)`);
  }
  if (from) { const [x, y] = proj(from); svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 7).attr("fill", "#ffb84d").attr("stroke", "#fff").attr("stroke-width", 2); }
  return svg.node();
}
```

<div class="grid grid-cols-3">
<div class="card observatory" style="grid-column: span 2">

### Lost supply (amber) and reallocated supply (teal)

```js
display(Plot.legend({color: {type: "sequential", interpolate: d3.interpolateRgb("#24343d", "#ffb84d"), domain: [0, Math.max(0.05, d3.max(impRows, (d) => d.unmet_share) ?? 0)], label: "Unmet demand, share of the importer's imports (scenario)", tickFormat: "%"}}));
display(resize((width) => scenarioMap(Math.max(width, 300))));
```

<span class="muted">Dashed amber: supply assumed lost. Teal: supply the model reallocates from other exporters (dotted where it would be a new trade link). These are statistical links, not shipping routes.</span>

</div>
<div class="card">

### Where the gap goes

```js
const wf = S ? [
  {step: "Exposed", start: 0, end: S.exposed_kusd, kind: "exposed"},
  {step: "Reallocated", start: S.exposed_kusd - S.reallocated_kusd, end: S.exposed_kusd, kind: "reallocated"},
  {step: "Unmet", start: 0, end: S.unmet_kusd, kind: "unmet"}
] : [];
display(resize((width) => Plot.plot({
  width, height: 240, marginLeft: 60, x: {label: null, domain: wf.map((d) => d.step)}, y: {label: "↑ Value", tickFormat: (d) => usd(d), grid: true},
  color: {domain: ["exposed", "reallocated", "unmet"], range: ["var(--tg-scenario-fill)", "#4dd4ac", "#c46b52"]},
  marks: [Plot.barY(wf, {x: "step", y1: "start", y2: "end", fill: "kind", tip: true, title: (d) => `${d.step}: ${usd(d.end - d.start)}`}), Plot.ruleY([0])]
})));
```

### Capacity sensitivity

```js
const sens = sum.map((d) => ({capacity: d.capacity[0].toUpperCase() + d.capacity.slice(1), unmet: d.unmet_kusd}));
display(resize((width) => Plot.plot({
  width, height: 150, marginLeft: 70, x: {label: "Unmet demand →", tickFormat: (d) => usd(d), grid: true}, y: {label: null, domain: ["Low", "Central", "High"]},
  marks: [
    hasMC ? Plot.ruleY(["Central"], {x1: S.mc_unmet_p5, x2: S.mc_unmet_p95, stroke: "var(--theme-foreground-muted)", strokeWidth: 10, strokeOpacity: 0.25}) : null,
    Plot.dot(sens, {x: "unmet", y: "capacity", r: 6, fill: (d) => (d.capacity === capacityLabel ? "#c46b52" : "var(--theme-foreground-faint)"), tip: true})
  ]
})));
```

<span class="muted">${hasMC ? "Grey band: 5th–95th percentile of unmet demand across 100 random capacity assumptions." : ""}</span>

</div>
</div>

```js
const top = impRows.slice(0, 15);
```

<div class="grid grid-cols-2">
<div class="card">

### Most affected importers: unmet share of imports

```js
display(resize((width) => Plot.plot({
  width, height: 30 * top.length + 40, marginLeft: 160, x: {label: "Unmet demand, share of imports →", tickFormat: "%", grid: true}, y: {label: null, domain: top.map((d) => nameOf.get(d.importer_iso3) ?? d.importer_iso3)},
  marks: [
    Plot.ruleY(top.filter((d) => d.unmet_share_p5 != null), {y: (d) => nameOf.get(d.importer_iso3) ?? d.importer_iso3, x1: "unmet_share_p5", x2: "unmet_share_p95", stroke: "var(--theme-foreground-muted)", strokeWidth: 8, strokeOpacity: 0.25}),
    Plot.dot(top, {y: (d) => nameOf.get(d.importer_iso3) ?? d.importer_iso3, x: "unmet_share", r: 5, fill: "#c46b52", tip: true, title: (d) => `${nameOf.get(d.importer_iso3)}\nunmet ${pct(d.unmet_share)} of imports (${usd(d.unmet_kusd)})`}),
    Plot.ruleX([0])
  ]
})));
```

<span class="muted">Dots: the selected capacity assumption. ${hasMC ? "Bands: 5th–95th percentile across random capacity draws." : ""}</span>

</div>
<div class="card">

### Assumption ledger

1. **Base year:** ${S?.year} observed flows (CEPII BACI). Every other number is model output.
2. **Shortfall:** ${nameOf.get(supplier)} delivers ${shortfall * 100}% less to *every* importer, for one year.
3. **Capacity (${capacityLabel}):** ${CAP_TEXT[capacity]}. This share is an assumption, not a measure of real spare capacity.
4. **Competition:** importers compete for the same alternative capacity. The model first gives every reachable importer the same fill rate, then uses any leftover capacity, preferring existing trade links. Only the ${40} largest alternative exporters are considered.
5. **Not modelled:** prices, stockpiles, demand response, product differences within the basket, contracts, logistics, policy, or knock-on effects on third countries. No welfare or GDP effects are implied.

</div>
</div>

<div class="card">

### All affected importers (${impRows.length})

```js
const fmt0 = (x) => (x == null ? "–" : Math.round(x).toLocaleString("en-US"));
display(Inputs.table(impRows.map((d) => ({
  Importer: nameOf.get(d.importer_iso3) ?? d.importer_iso3, ISO3: d.importer_iso3,
  "Exposed (k USD)": d.exposed_kusd, "Reallocated (k USD)": d.reallocated_kusd, "Unmet (k USD)": d.unmet_kusd,
  "Unmet, % of imports": d.unmet_share, "Range p5–p95": d.unmet_share_p5 == null ? "–" : `${pct(d.unmet_share_p5)} – ${pct(d.unmet_share_p95)}`
})), {rows: 12, layout: "auto", format: {"Exposed (k USD)": fmt0, "Reallocated (k USD)": fmt0, "Unmet (k USD)": fmt0, "Unmet, % of imports": pct}}));
```

</div>
