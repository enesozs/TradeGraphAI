---
title: Dependency profile
---


# How concentrated is a country's supply?

```js
const info = FileAttachment("data/build_info.json").json();
```

```js
const db = DuckDBClient.of({
  imp: FileAttachment("data/importer_basket_year.parquet"),
  sup: FileAttachment("data/supplier_basket_year.parquet")
});
```

```js
// ---- helpers ----
const NAME_OVERRIDE = {S19: "Other Asia, nes (incl. Taiwan)"};
const cname = (iso3, name) => NAME_OVERRIDE[iso3] ?? name;
const usd = (kusd) => {
  if (kusd == null || isNaN(kusd)) return "–";
  const v = kusd * 1e3;
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)} tn`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 1 : 2)} bn`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} m`;
  return `$${(v / 1e3).toFixed(0)} k`;
};
const tonnes = (t) => (t == null ? "–" : t >= 1e6 ? `${(t / 1e6).toFixed(2)} Mt` : t >= 1e3 ? `${(t / 1e3).toFixed(1)} kt` : `${t.toFixed(0)} t`);
const pct = (x) => (x == null ? "–" : `${(100 * x).toFixed(1)}%`);
const rows = (r) => Array.from(r, (d) => ({...d}));
```

```js
const basket = view(Inputs.select(info.baskets, {label: "Product basket", format: (b) => b.label, value: info.baskets[0]}));
```

```js
const importerList = rows(await db.query(
  `SELECT importer_iso3 AS iso3, any_value(importer_name) AS name, max(imports_kusd) AS mx
   FROM imp WHERE basket_id = ? GROUP BY 1 ORDER BY mx DESC`, [basket.id]));
const defaultImporter = importerList.find((d) => d.iso3 === "DEU") ?? importerList[0];
```

```js
const importer = view(Inputs.select(importerList, {
  label: "Importer",
  format: (d) => `${cname(d.iso3, d.name)} (${d.iso3})`,
  value: defaultImporter
}));
const finalYears = info.years.filter((y) => !info.provisional_years.includes(y));
const year = view(Inputs.select(info.years, {label: "Year", value: finalYears.at(-1), format: (y) => (info.provisional_years.includes(y) ? `${y} (provisional)` : String(y))}));
const basis = view(Inputs.radio(basket.value_only ? ["Value"] : ["Value", "Tonnes"], {label: "Basis", value: "Value"}));
```

<div class="chips">
  <span class="chip obs">OBSERVED</span>
  <span class="chip">CEPII BACI · ${info.source.hs_revision} · V${info.source.release}</span>
  <span class="chip">Value: thousand current USD (FOB-reconciled)</span>
  <span class="chip">Denominator: imports from all partner countries</span>
</div>

```js
const series = rows(await db.query(
  `SELECT * FROM imp WHERE basket_id = ? AND importer_iso3 = ? ORDER BY year`, [basket.id, importer.iso3]));
const cur = series.find((d) => d.year === year);
const suppliers = rows(await db.query(
  `SELECT * FROM sup WHERE basket_id = ? AND importer_iso3 = ? AND year = ? ORDER BY rank_value`,
  [basket.id, importer.iso3, year]));
const useT = basis === "Tonnes";
```

```js
const importerLabel = cname(importer.iso3, importer.name);
display(html`<h2>${importerLabel} · ${basket.label} · ${year}</h2>`);
if (!cur) display(html`<div class="banner">No recorded imports of this basket for ${importerLabel} in ${year}. Missing flows are <em>not recorded</em>, which is not the same as zero.</div>`);
if (cur?.is_provisional) display(html`<div class="banner"><strong>Provisional year.</strong> CEPII warns that values for the latest year in a release (${year}) may be substantially revised.</div>`);
if (useT && cur && cur.tonnes_coverage < 0.9) display(html`<div class="banner">Quantities are recorded for only ${pct(cur.tonnes_coverage)} of this import value, so the tonnes view is partial.</div>`);
if (cur && !basket.value_only && cur.hhi_tonnes != null && Math.abs(cur.hhi_value - cur.hhi_tonnes) > 0.1)
  display(html`<div class="banner"><strong>Price check:</strong> concentration by value (HHI ${cur.hhi_value.toFixed(2)}) and by tonnes (HHI ${cur.hhi_tonnes.toFixed(2)}) differ a lot. Unit prices vary across suppliers, so compare both views before drawing conclusions.</div>`);
```

```js
const top1 = cur ? cname(cur.top1_supplier_iso3, cur.top1_supplier_name) : "–";
```

<div class="grid grid-cols-4">
  <div class="card kpi"><div class="sub">Total imports</div><div class="big">${useT ? tonnes(cur?.imports_t) : usd(cur?.imports_kusd)}</div><div class="sub">${useT ? "recorded quantity" : "all partner countries"}</div></div>
  <div class="card kpi"><div class="sub">Suppliers</div><div class="big">${cur?.supplier_count ?? "–"}</div><div class="sub">effective: ${cur ? cur.effective_suppliers.toFixed(1) : "–"} (= 1 / HHI)</div></div>
  <div class="card kpi"><div class="sub">Concentration (HHI)</div><div class="big">${cur ? (useT ? cur.hhi_tonnes : cur.hhi_value)?.toFixed(2) ?? "–" : "–"}</div><div class="sub">0 = dispersed · 1 = single supplier</div></div>
  <div class="card kpi"><div class="sub">Largest supplier</div><div class="big">${cur ? pct(cur.top1_share_value) : "–"}</div><div class="sub">${top1} · by value</div></div>
</div>

```js
// ---- supplier share bars: top 10 + all others ----
const shareKey = useT ? "share_tonnes" : "share_value";
const ranked = suppliers.filter((d) => d[shareKey] != null).sort((a, b) => b[shareKey] - a[shareKey]);
const top = ranked.slice(0, 10).map((d) => ({label: cname(d.supplier_iso3, d.supplier_name), share: d[shareKey], amount: useT ? tonnes(d.quantity_t) : usd(d.value_kusd), other: false}));
const rest = ranked.slice(10);
if (rest.length) top.push({label: `All others (${rest.length})`, share: d3.sum(rest, (d) => d[shareKey]), amount: useT ? tonnes(d3.sum(rest, (d) => d.quantity_t)) : usd(d3.sum(rest, (d) => d.value_kusd)), other: true});
```

<div class="grid grid-cols-2">
<div class="card">

### Supplier shares, ${year}

<span class="muted">Share of ${importerLabel}'s ${useT ? "recorded tonnes" : "import value"} from each supplier.</span>

```js
display(top.length ? resize((width) => Plot.plot({
  width: Math.max(width, 300), marginLeft: Math.min(190, Math.max(110, width * 0.38)), marginRight: 56, height: 28 * top.length + 40,
  x: {label: "Share →", tickFormat: "%", domain: [0, Math.max(0.05, d3.max(top, (d) => d.share))]},
  y: {label: null, domain: top.map((d) => d.label)},
  marks: [
    Plot.barX(top, {x: "share", y: "label", fill: (d) => (d.other ? "var(--theme-foreground-faint)" : "var(--theme-foreground-focus)"), tip: {format: {x: ".1%"}}, title: (d) => `${d.label}\n${pct(d.share)} · ${d.amount}`}),
    Plot.text(top, {x: "share", y: "label", text: (d) => pct(d.share), dx: 4, textAnchor: "start"}),
    Plot.ruleX([0])
  ]
})) : html`<p class="muted">No data.</p>`);
```

</div>
<div class="card">

### Concentration over time

<span class="muted">HHI and largest-supplier share by year${basket.value_only ? "" : "; dashed line = HHI by tonnes"}. Hollow points are provisional.</span>

```js
const long = series.flatMap((d) => [
  {year: d.year, metric: "HHI (value)", v: d.hhi_value, prov: d.is_provisional},
  {year: d.year, metric: "Largest supplier share", v: d.top1_share_value, prov: d.is_provisional},
  ...(basket.value_only || d.hhi_tonnes == null ? [] : [{year: d.year, metric: "HHI (tonnes)", v: d.hhi_tonnes, prov: d.is_provisional}])
]);
const metricsShown = basket.value_only ? ["HHI (value)", "Largest supplier share"] : ["HHI (value)", "HHI (tonnes)", "Largest supplier share"];
const metricColors = {"HHI (value)": "#4269d0", "HHI (tonnes)": "#97bbf5", "Largest supplier share": "#c08a1e"};
display(resize((width) => Plot.plot({
  width, height: 300, marginRight: 20,
  x: {label: null, tickFormat: "d", domain: d3.extent(info.years), ticks: info.years.filter((y) => y % 2 === 0)},
  y: {label: "↑ Index / share", domain: [0, 1], grid: true},
  color: {legend: true, domain: metricsShown, range: metricsShown.map((m) => metricColors[m])},
  marks: [
    Plot.ruleX([year], {stroke: "var(--theme-foreground-faint)"}),
    Plot.lineY(long, {x: "year", y: "v", stroke: "metric", strokeDasharray: (d) => (d.metric === "HHI (tonnes)" ? "4,3" : null), z: "metric"}),
    Plot.dot(long, {x: "year", y: "v", stroke: "metric", fill: (d) => (d.prov ? "var(--theme-background)" : d.metric), r: 3, tip: true, title: (d) => `${d.metric} · ${d.year}${d.prov ? " (provisional)" : ""}\n${d.v.toFixed(3)}`})
  ]
})));
```

</div>
</div>

```js
// ---- supplier mix over time: top 5 suppliers across all years + others ----
const mixRaw = rows(await db.query(
  `SELECT year, supplier_iso3, supplier_name, value_kusd, quantity_t FROM sup WHERE basket_id = ? AND importer_iso3 = ?`,
  [basket.id, importer.iso3]));
const amt = (d) => (useT ? d.quantity_t ?? 0 : d.value_kusd);
const top5 = d3.groupSort(mixRaw, (g) => -d3.sum(g, amt), (d) => d.supplier_iso3).slice(0, 5);
const nameOf = new Map(mixRaw.map((d) => [d.supplier_iso3, cname(d.supplier_iso3, d.supplier_name)]));
const mix = d3.flatRollup(mixRaw, (g) => d3.sum(g, amt), (d) => d.year, (d) => (top5.includes(d.supplier_iso3) ? nameOf.get(d.supplier_iso3) : "All others"))
  .map(([year, supplier, v]) => ({year, supplier, v}));
const order = [...top5.map((c) => nameOf.get(c)), "All others"];
```

<div class="card">

### Supplier mix over time

<span class="muted">Share of ${importerLabel}'s ${useT ? "tonnes" : "import value"} from the five largest suppliers over the period.</span>

```js
display(resize((width) => Plot.plot({
  width, height: 300, marginRight: 20,
  x: {label: null, tickFormat: "d", domain: d3.extent(info.years), ticks: info.years.filter((y) => y % 2 === 0)},
  y: {label: "↑ Share", tickFormat: "%", grid: true},
  color: {legend: true, domain: order, range: [...d3.schemeTableau10.slice(0, top5.length), "#bab0ac"]},
  marks: [
    Plot.areaY(mix, Plot.stackY({offset: "normalize", order}, {x: "year", y: "v", fill: "supplier", tip: true, title: (d) => `${d.supplier} · ${d.year}`})),
    Plot.ruleX([year], {stroke: "var(--theme-foreground)", strokeOpacity: 0.4})
  ]
})));
```

</div>

<div class="card scenario">

### Exposure scenario: what if one supplier fell short?

<span class="chip scen">SCENARIO</span> <span class="muted">Observed ${year} data plus one stated assumption. This is not a forecast or a causal estimate. Values only (USD).</span>

```js
const supplierOptions = suppliers.map((d) => ({iso3: d.supplier_iso3, label: cname(d.supplier_iso3, d.supplier_name), value: d.value_kusd, R: d.redirectable_kusd}));
const shocked = suppliers.length ? view(Inputs.select(supplierOptions, {label: "Supplier", format: (d) => d.label, value: supplierOptions[0]})) : null;
const shortfall = view(Inputs.range([0, 1], {label: "Assumed shortfall (0–1)", step: 0.05, value: 0.4}));
```

```js
// Mirrors tradegraph.scenarios.exposure.direct_exposure (tested in tests/test_exposure.py).
const scen = (() => {
  if (!shocked) return null;
  const imports = d3.sum(supplierOptions, (d) => d.value);
  const exposed = shocked.value * shortfall;
  const alts = supplierOptions.filter((d) => d.iso3 !== shocked.iso3).sort((a, b) => b.R - a.R);
  const totalR = d3.sum(alts, (d) => d.R);
  return {imports, exposed, share: imports ? exposed / imports : 0, alts, totalR, coverage: exposed ? totalR / exposed : null};
})();
```

```js
if (scen) display(html`<div class="grid grid-cols-3" style="margin-top:.75rem">
  <div class="kpi"><div class="sub">Directly exposed imports</div><div class="big scen-ink">${usd(scen.exposed)}</div><div class="sub">${Math.round(shortfall * 100)}% of ${shocked.label}'s ${usd(shocked.value)}</div></div>
  <div class="kpi"><div class="sub">Share of ${importerLabel}'s imports</div><div class="big scen-ink">${pct(scen.share)}</div><div class="sub">of ${usd(scen.imports)} total (${basket.label})</div></div>
  <div class="kpi"><div class="sub">Other suppliers' redirectable supply</div><div class="big">${usd(scen.totalR)}</div><div class="sub">${scen.coverage == null ? "no exposure at 0% shortfall" : `${scen.coverage >= 100 ? ">100" : scen.coverage.toFixed(1)}× the exposed value (observed upper bound)`}</div></div>
</div>`);
```

```js
if (scen) display(resize((width) => Plot.plot({
  width: Math.max(width, 300), height: 70, marginLeft: 10, marginRight: 10,
  x: {label: null, tickFormat: (d) => usd(d), domain: [0, scen.imports]},
  y: {axis: null},
  marks: [
    Plot.barX([{a: 0, b: scen.imports}], {x1: "a", x2: "b", fill: "var(--theme-foreground-faint)", title: () => `Total imports: ${usd(scen.imports)}`}),
    Plot.barX([{a: 0, b: scen.exposed}], {x1: "a", x2: "b", fill: "#c08a1e", title: () => `Exposed: ${usd(scen.exposed)}`}),
    Plot.text([scen], {x: (d) => d.exposed, text: () => `exposed ${pct(scen.share)}`, dx: 6, textAnchor: "start", fill: "currentColor"})
  ]
})));
```

```js
if (scen) {
  const altTable = scen.alts.slice(0, 15).map((d) => ({
    Supplier: d.label, ISO3: d.iso3,
    "Already supplies (k USD)": d.value,
    "Redirectable (k USD)": d.R,
    "Redirectable ÷ exposed": scen.exposed ? d.R / scen.exposed : null
  }));
  display(html`<h4 style="margin:.75rem 0 .25rem">Alternative suppliers, ranked by redirectable supply</h4>`);
  display(Inputs.table(altTable, {rows: 8, layout: "auto", format: {
    "Already supplies (k USD)": (x) => Math.round(x).toLocaleString("en-US"),
    "Redirectable (k USD)": (x) => Math.round(x).toLocaleString("en-US"),
    "Redirectable ÷ exposed": (x) => (x == null ? "–" : x >= 100 ? ">100×" : `${x.toFixed(2)}×`)
  }}));
}
```

<details class="muted"><summary><strong>Assumption ledger</strong></summary>

1. **Stated assumption:** deliveries from ${shocked?.label ?? "the selected supplier"} fall by ${Math.round(shortfall * 100)}% for one year, using ${year} values.
2. **Observed:** every other number comes from CEPII BACI ${info.source.hs_revision} V${info.source.release}.
3. **Redirectable supply** is what each alternative supplier exported in this basket to all *other* countries in ${year}. That's an upper bound: contracts, product mix within the basket, quality certification, logistics, policy and the supplier's own needs all limit how much could really be redirected.
4. **Not modelled:** price changes, stockpiles, demand response, new suppliers, or knock-on effects on other countries. No welfare or GDP effects are implied.

</details>

</div>

<div class="card">

### Suppliers, ${year}: data table

<span class="muted"><strong>Redirectable supply</strong> is what each supplier exported in this basket to every <em>other</em> country in ${year}. It's an observed upper bound, not an estimate of how much could actually be redirected.</span>

```js
const table = suppliers.map((d) => ({
  Rank: d.rank_value,
  Supplier: cname(d.supplier_iso3, d.supplier_name),
  ISO3: d.supplier_iso3,
  "Value (k USD)": d.value_kusd,
  "Share (value)": d.share_value,
  "Tonnes": d.quantity_t,
  "Share (tonnes)": d.share_tonnes,
  "Redirectable (k USD)": d.redirectable_kusd
}));
const fmt0 = (x) => (x == null ? "–" : Math.round(x).toLocaleString("en-US"));
display(Inputs.table(table, {
  rows: 12,
  layout: "auto",
  format: {"Value (k USD)": fmt0, "Share (value)": pct, "Tonnes": fmt0, "Share (tonnes)": pct, "Redirectable (k USD)": fmt0},
  columns: basket.value_only ? ["Rank", "Supplier", "ISO3", "Value (k USD)", "Share (value)", "Redirectable (k USD)"] : undefined
}));
const csv = d3.csvFormat(table);
display(html`<a download="tradegraph_${basket.id}_${importer.iso3}_${year}.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(csv)}">Download CSV</a>`);
```

</div>

<div class="muted">

**How to read this.** Shares use the importer's total imports from **all** partner countries. A country with no row has *no recorded* trade, which doesn't mean zero. Lines and areas connect yearly observations; nothing in between is measured. "Other Asia, nes" is how BACI records Taiwan. Re-exports through trade hubs (e.g. Hong Kong, Singapore, the Netherlands) can make a hub look like a large supplier. Basket definition: ${basket.codes.join(", ")} (HS12). ${basket.caveats?.length ? "Caveats: " + basket.caveats.join(" ") : ""} See [Methodology](./methodology.html).

</div>
