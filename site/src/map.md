---
title: Map
---

# Where does each country's supply come from?

```js
import {CANVAS, communityColor, addDefs, arcPath, usd} from "./components/observatory.js";
import * as topojson from "npm:topojson-client";
const info = FileAttachment("data/build_info.json").json();
const world = FileAttachment("data/countries-110m.json").json();
const db = DuckDBClient.of({
  imp: FileAttachment("data/importer_basket_year.parquet"),
  sup: FileAttachment("data/supplier_basket_year.parquet"),
  geo: FileAttachment("data/country_geo.parquet"),
  nodes: FileAttachment("data/network_nodes.parquet"),
  edges: FileAttachment("data/network_edges.parquet")
});
```

```js
const rows = (r) => Array.from(r, (d) => ({...d}));
const NAME_OVERRIDE = {S19: "Other Asia, nes (incl. Taiwan)"};
const cname = (iso3, name) => NAME_OVERRIDE[iso3] ?? name ?? iso3;
const pct = (x) => (x == null ? "–" : `${(100 * x).toFixed(1)}%`);
const countries = topojson.feature(world, world.objects.countries);
const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
const geoRows = rows(await db.query(`SELECT iso3, iso_num, country_name FROM geo WHERE iso_num IS NOT NULL`));
const byNum = new Map(geoRows.map((d) => [String(d.iso_num).padStart(3, "0"), d]));
const nameOf = new Map(geoRows.map((d) => [d.iso3, cname(d.iso3, d.country_name)]));
// Anchor = centroid of each country's largest polygon (overseas territories don't drag it into the ocean).
const anchor = new Map();
for (const f of countries.features) {
  const g = byNum.get(f.id); if (!g) continue;
  const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map((c) => ({type: "Polygon", coordinates: c})) : [f.geometry];
  anchor.set(g.iso3, d3.geoCentroid(d3.greatest(polys, (p) => d3.geoArea(p))));
}
```

```js
const labelOf = new Map(info.baskets.map((b) => [b.id, b.label]));
const basketId = view(Inputs.select(info.baskets.map((b) => b.id), {label: "Product basket", format: (id) => labelOf.get(id)}));
const finalYears = info.years.filter((y) => !info.provisional_years.includes(y));
const year = view(Inputs.range(d3.extent(info.years), {label: "Year", step: 1, value: finalYears.at(-1)}));
const mode = view(Inputs.radio(["Trade flows", "Share from one supplier", "Concentration (HHI)", "Disruption preview"], {label: "Show", value: "Trade flows"}));
const projection = view(Inputs.radio(["Map", "Globe"], {label: "View", value: "Map"}));
```

```js
const supplierList = rows(await db.query(
  `SELECT supplier_iso3 AS iso3, any_value(supplier_name) AS name, sum(value_kusd) AS v FROM sup WHERE basket_id = ? AND year = ? GROUP BY 1 ORDER BY v DESC LIMIT 40`, [basketId, year]));
const importerList = rows(await db.query(
  `SELECT importer_iso3 AS iso3, importer_name AS name FROM imp WHERE basket_id = ? AND year = ? ORDER BY imports_kusd DESC`, [basketId, year]));
```

```js
const supplier = view(Inputs.select(supplierList, {label: "Supplier", format: (d) => cname(d.iso3, d.name), value: supplierList.find((d) => d.iso3 === "CHN") ?? supplierList[0], disabled: !["Share from one supplier", "Disruption preview"].includes(mode)}));
const shortfall = view(Inputs.range([0, 1], {label: "Assumed shortfall (0–1)", step: 0.05, value: 0.5, disabled: mode !== "Disruption preview"}));
const focus = view(Inputs.select([null, ...importerList], {label: "Highlight importer", format: (d) => (d ? cname(d.iso3, d.name) : "None (all flows)"), value: null, disabled: mode !== "Trade flows"}));
const topN = view(Inputs.range([30, 250], {label: "Largest links drawn", step: 10, value: 120, disabled: !["Trade flows", "Disruption preview"].includes(mode)}));
const rotate = view(Inputs.range([-180, 180], {label: "Globe longitude", step: 5, value: 70, disabled: projection !== "Globe"}));
```

```js
const isScenario = mode === "Disruption preview";
const nodeRows = rows(await db.query(`SELECT iso3, community, exports_kusd, imports_kusd FROM nodes WHERE basket_id = ? AND year = ?`, [basketId, year]));
const nodeOf = new Map(nodeRows.map((d) => [d.iso3, d]));
const edgeRows = rows(await db.query(`SELECT exporter_iso3 AS e, importer_iso3 AS i, value_kusd AS v FROM edges WHERE basket_id = ? AND year = ? ORDER BY value_kusd DESC LIMIT ?`, [basketId, year, topN]));
const imp = rows(await db.query(`SELECT importer_iso3 AS iso3, hhi_value, imports_kusd FROM imp WHERE basket_id = ? AND year = ?`, [basketId, year]));
const fromSup = rows(await db.query(`SELECT importer_iso3 AS iso3, share_value, value_kusd FROM sup WHERE basket_id = ? AND year = ? AND supplier_iso3 = ?`, [basketId, year, supplier?.iso3]));
const supOf = new Map(fromSup.map((d) => [d.iso3, d]));
// One value per importer for the land colouring, depending on the mode.
const landValue = new Map(imp.map((d) => {
  const s = supOf.get(d.iso3)?.share_value ?? 0; // share of RECORDED imports (0 if no recorded flow from this supplier)
  const v = mode === "Concentration (HHI)" ? d.hhi_value : mode === "Share from one supplier" ? s : mode === "Disruption preview" ? s * shortfall : null;
  return [d.iso3, {...d, share: s, value: v}];
}));
const exposedTotal = d3.sum(fromSup, (d) => d.value_kusd) * shortfall;
```

<div class="chips">
  ${isScenario ? html`<span class="chip scen">SCENARIO · assumed ${Math.round(shortfall * 100)}% shortfall from ${cname(supplier?.iso3, supplier?.name)}</span>` : html`<span class="chip obs">OBSERVED</span>`}
  <span class="chip">CEPII BACI ${info.source.hs_revision} V${info.source.release}</span>
  <span class="chip">${year}${info.provisional_years.includes(year) ? " · PROVISIONAL" : ""}</span>
  <span class="chip">Borders: Natural Earth 1:110m (public domain)</span>
</div>

```js
function tradeMap(width) {
  const height = projection === "Globe" ? Math.min(width, 760) : Math.round(width * 0.52);
  const proj = projection === "Globe"
    ? d3.geoOrthographic().rotate([-rotate, -18]).fitExtent([[10, 10], [width - 10, height - 10]], {type: "Sphere"})
    : d3.geoEqualEarth().fitExtent([[6, 6], [width - 6, height - 6]], {type: "Sphere"});
  const path = d3.geoPath(proj);
  const visible = (lonlat) => path({type: "Point", coordinates: lonlat}) != null;
  const svg = d3.create("svg").attr("class", "map").attr("viewBox", [0, 0, width, height]).attr("role", "img")
    .attr("aria-label", `${mode}, ${labelOf.get(basketId)}, ${year}. Exact numbers are in the tables below the map.`);
  const fx = addDefs(svg, "map");
  svg.append("rect").attr("width", width).attr("height", height).attr("fill", CANVAS.bg);
  svg.append("path").attr("d", path({type: "Sphere"})).attr("fill", CANVAS.ocean).attr("stroke", "#ffffff22");
  svg.append("path").attr("d", path(d3.geoGraticule10())).attr("fill", "none").attr("stroke", "#ffffff10");

  // Land: neutral in "Trade flows"; coloured by the mode's value otherwise.
  const hi = mode === "Concentration (HHI)" ? "#ff4d6d" : isScenario ? "#ffb84d" : "#5aa9ff";
  const vmax = isScenario ? Math.max(0.05, d3.max(landValue.values(), (d) => d.value) ?? 0) : 1;
  const landColor = d3.scaleSequentialSqrt([0, vmax], d3.interpolateRgb("#24343d", hi));
  svg.append("g").selectAll("path").data(countries.features).join("path").attr("d", path)
    .attr("fill", (f) => {
      const g = byNum.get(f.id); const v = g && landValue.get(g.iso3);
      if (mode === "Trade flows") return focus && g?.iso3 === focus.iso3 ? "#2f4652" : CANVAS.land;
      return v ? landColor(v.value) : "#141d22";
    })
    .append("title").text((f) => {
      const g = byNum.get(f.id); if (!g) return f.properties.name;
      const v = landValue.get(g.iso3);
      if (!v) return `${nameOf.get(g.iso3)}: no recorded imports of this basket in ${year}`;
      if (mode === "Concentration (HHI)") return `${nameOf.get(g.iso3)}\nHHI ${v.hhi_value.toFixed(2)} · imports ${usd(v.imports_kusd)}`;
      if (isScenario) return `${nameOf.get(g.iso3)}\nSCENARIO: ${pct(v.value)} of recorded imports directly exposed\n(${pct(v.share)} from ${supplier?.iso3} × ${Math.round(shortfall * 100)}% shortfall)`;
      return `${nameOf.get(g.iso3)}\n${pct(v.share)} of recorded imports from ${supplier?.iso3} · imports ${usd(v.imports_kusd)}`;
    });
  svg.append("path").attr("d", path(borders)).attr("fill", "none").attr("stroke", CANVAS.landEdge).attr("stroke-width", 0.6);

  // Flows: curved arcs from exporter to importer (statistical links, not routes).
  if (mode === "Trade flows" || isScenario) {
    const maxV = d3.max(edgeRows, (d) => d.v) ?? 1;
    const w = d3.scaleSqrt([0, maxV], [0.4, 6]);
    const g = svg.append("g").attr("fill", "none").attr("stroke-linecap", "round").attr("filter", fx.glow).style("mix-blend-mode", "screen");
    for (const e of edgeRows) {
      const a = anchor.get(e.e), b = anchor.get(e.i);
      if (!a || !b || !visible(a) || !visible(b)) continue;
      const d = projection === "Globe" ? path({type: "LineString", coordinates: [a, b]}) : arcPath(proj(a), proj(b), 0.2);
      const shocked = isScenario && e.e === supplier?.iso3;
      const dim = (mode === "Trade flows" && focus && e.i !== focus.iso3) || (isScenario && !shocked);
      g.append("path").attr("d", d)
        .attr("stroke", shocked ? "#ffb84d" : communityColor(nodeOf.get(e.e)?.community))
        .attr("stroke-dasharray", shocked ? "6,4" : null)
        .attr("stroke-width", w(e.v)).attr("stroke-opacity", dim ? 0.07 : 0.25 + 0.65 * Math.sqrt(e.v / maxV))
        .append("title").text(`${nameOf.get(e.e) ?? e.e} → ${nameOf.get(e.i) ?? e.i}: ${usd(e.v)}${shocked ? `\nSCENARIO: ${usd(e.v * shortfall)} exposed` : ""}`);
    }
    // Country nodes sized by trade in this basket.
    const size = d3.scaleSqrt([0, d3.max(nodeRows, (d) => d.exports_kusd + d.imports_kusd) ?? 1], [0, 14]);
    const used = new Set(edgeRows.flatMap((e) => [e.e, e.i]));
    const n = svg.append("g").attr("filter", fx.glow);
    for (const iso of used) {
      const ll = anchor.get(iso), nd = nodeOf.get(iso); if (!ll || !nd || !visible(ll)) continue;
      const [x, y] = proj(ll);
      const ring = (isScenario && iso === supplier?.iso3) || (focus && iso === focus.iso3);
      n.append("circle").attr("cx", x).attr("cy", y).attr("r", Math.max(1.8, size(nd.exports_kusd + nd.imports_kusd)))
        .attr("fill", isScenario && iso === supplier?.iso3 ? "#ffb84d" : communityColor(nd.community)).attr("fill-opacity", 0.9)
        .attr("stroke", ring ? "#ffffff" : CANVAS.bg).attr("stroke-width", ring ? 2 : 0.6)
        .append("title").text(`${nameOf.get(iso) ?? iso}\nExports ${usd(nd.exports_kusd)} · Imports ${usd(nd.imports_kusd)} · community ${nd.community + 1}`);
    }
  }
  return svg.node();
}
```

<div class="card observatory">

### ${mode === "Trade flows" ? `${labelOf.get(basketId)}: largest import flows, ${year}` : mode === "Concentration (HHI)" ? `Import concentration: ${labelOf.get(basketId)}, ${year}` : mode === "Share from one supplier" ? `Share of each country's ${labelOf.get(basketId)} imports from ${cname(supplier?.iso3, supplier?.name)}, ${year}` : `Scenario: ${Math.round(shortfall * 100)}% shortfall of ${labelOf.get(basketId)} from ${cname(supplier?.iso3, supplier?.name)}, ${year} data`}

```js
if (mode === "Trade flows") display(html`<span class="muted">Arcs run from exporter to importer, coloured by the exporter's trade community; width shows value. Nodes are sized by trade in this basket.</span>`);
else if (isScenario) display(Plot.legend({color: {type: "sequential", interpolate: d3.interpolateRgb("#24343d", "#ffb84d"), domain: [0, Math.max(0.05, d3.max(landValue.values(), (d) => d.value) ?? 0)], label: "Share of recorded imports directly exposed (scenario)", tickFormat: "%"}}));
else display(Plot.legend({color: {type: "sequential", interpolate: d3.interpolateRgb("#24343d", mode === "Concentration (HHI)" ? "#ff4d6d" : "#5aa9ff"), domain: [0, 1], label: mode === "Concentration (HHI)" ? "HHI (0 = dispersed, 1 = single supplier)" : "Share of recorded imports", tickFormat: mode === "Concentration (HHI)" ? ".1f" : "%"}}));
display(resize((width) => tradeMap(Math.max(width, 300))));
```

<span class="muted">Lines are statistical links between countries (who traded how much with whom), <strong>not shipping routes</strong>; BACI holds no route data. Dark grey: no recorded imports of this basket that year (missing is not zero). Taiwan's trade appears as "Other Asia, nes" in BACI.${isScenario ? " Disruption preview: each importer's directly exposed share = its share of recorded imports from the supplier × the assumed shortfall. It does not model substitution, prices or knock-on effects; for alternatives, see the exposure panel on the Dependency profile." : ""}</span>

</div>

```js
const scenarioRows = d3.sort([...landValue.values()].filter((d) => d.share > 0), (d) => -d.value).map((d) => ({
  Importer: nameOf.get(d.iso3) ?? d.iso3, ISO3: d.iso3, [`Share from ${supplier?.iso3}`]: d.share,
  "Exposed share (scenario)": d.value, "Exposed value (k USD)": (supOf.get(d.iso3)?.value_kusd ?? 0) * shortfall, "Imports (k USD)": d.imports_kusd
}));
const fmt0 = (x) => (x == null ? "–" : Math.round(x).toLocaleString("en-US"));
```

```js
if (isScenario) display(html`<div class="grid grid-cols-3">
  <div class="card kpi"><div class="sub">Exposed imports worldwide</div><div class="big scen-ink">${usd(exposedTotal)}</div><div class="sub">${Math.round(shortfall * 100)}% of ${supplier?.iso3}'s recorded basket exports</div></div>
  <div class="card kpi"><div class="sub">Importers with &gt;10% of imports exposed</div><div class="big scen-ink">${scenarioRows.filter((d) => d["Exposed share (scenario)"] > 0.1).length}</div><div class="sub">of ${scenarioRows.length} importers buying from ${supplier?.iso3}</div></div>
  <div class="card kpi"><div class="sub">Most exposed (share)</div><div class="big scen-ink">${scenarioRows[0] ? pct(scenarioRows[0]["Exposed share (scenario)"]) : "–"}</div><div class="sub">${scenarioRows[0]?.Importer ?? ""}</div></div>
</div>`);
```

<div class="card">

### ${isScenario ? "Most exposed importers (scenario)" : mode === "Trade flows" ? `Largest ${edgeRows.length} flows` : "All importers"}

```js
if (isScenario) display(Inputs.table(scenarioRows, {rows: 12, layout: "auto", format: {[`Share from ${supplier?.iso3}`]: pct, "Exposed share (scenario)": pct, "Exposed value (k USD)": fmt0, "Imports (k USD)": fmt0}}));
else if (mode === "Trade flows") display(Inputs.table(edgeRows.map((e) => ({Exporter: nameOf.get(e.e) ?? e.e, Importer: nameOf.get(e.i) ?? e.i, "Value (k USD)": e.v, "Exporter community": (nodeOf.get(e.e)?.community ?? -1) + 1})), {rows: 12, layout: "auto", format: {"Value (k USD)": fmt0}}));
else display(Inputs.table(d3.sort([...landValue.values()], (d) => -d.value).map((d) => (mode === "Concentration (HHI)"
  ? {Importer: nameOf.get(d.iso3) ?? d.iso3, ISO3: d.iso3, HHI: d.hhi_value, "Imports (k USD)": d.imports_kusd}
  : {Importer: nameOf.get(d.iso3) ?? d.iso3, ISO3: d.iso3, [`Share from ${supplier?.iso3}`]: d.share, "Imports (k USD)": d.imports_kusd})),
  {rows: 12, layout: "auto", format: {HHI: (x) => x.toFixed(3), [`Share from ${supplier?.iso3}`]: pct, "Imports (k USD)": fmt0}}));
```

</div>
