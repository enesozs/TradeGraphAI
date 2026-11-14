---
title: EU monthly monitor
---

# EU monthly monitor: who supplies Europe, month by month?

```js
import {cname} from "./components/geo.js";
const info = FileAttachment("data/build_info.json").json();
const cx = FileAttachment("data/comext_info.json").json();
const db = DuckDBClient.of({
  imp: FileAttachment("data/comext_importer.parquet"),
  sup: FileAttachment("data/comext_supplier.parquet"),
  geo: FileAttachment("data/country_geo.parquet")
});
```

```js
const rows = (r) => Array.from(r, (d) => ({...d}));
const eur = (v) => (v == null ? "–" : v >= 1e9 ? `€${(v / 1e9).toFixed(2)} bn` : v >= 1e6 ? `€${(v / 1e6).toFixed(1)} m` : `€${(v / 1e3).toFixed(0)} k`);
const pct = (x) => (x == null || isNaN(x) ? "–" : `${(100 * x).toFixed(1)}%`);
const geoRows = rows(await db.query(`SELECT iso3, country_name FROM geo`));
const nameOf = new Map(geoRows.map((d) => [d.iso3, cname(d.iso3, d.country_name)]));
const REPORTER_LABEL = {EU27_2020_EXTRA: "EU27, imports from outside the EU", EU27_2020: "EU27, all partners (incl. intra-EU)", DE: "Germany", FR: "France", IT: "Italy", NL: "Netherlands", ES: "Spain", PL: "Poland"};
const labelOf = new Map(info.baskets.map((b) => [b.id, b.label]));
const monthFmt = d3.utcFormat("%b %Y");
```

```js
const reporter = view(Inputs.select(cx.reporters.slice().sort((a, b) => (a === "EU27_2020_EXTRA" ? -1 : b === "EU27_2020_EXTRA" ? 1 : 0)), {label: "Importer", format: (r) => REPORTER_LABEL[r] ?? r, value: "EU27_2020_EXTRA"}));
const basketId = view(Inputs.select(info.baskets.map((b) => b.id), {label: "Product basket", format: (id) => labelOf.get(id), value: "li_ion_batteries"}));
const basis = view(Inputs.radio(["Trailing 12 months", "Single month"], {label: "View", value: "Trailing 12 months"}));
```

<div class="chips">
  <span class="chip obs">OBSERVED</span>
  <span class="chip">Eurostat Comext DS-045409 · values in EUR</span>
  <span class="chip">Data to ${monthFmt(new Date(cx.latest_month))} (Eurostat update ${cx.eurostat_last_update})</span>
  <span class="chip">Separate source: not directly comparable with the BACI pages (USD, reconciled, annual)</span>
</div>

```js
const ttm = basis === "Trailing 12 months";
const series = rows(await db.query(`SELECT * FROM imp WHERE reporter = ? AND basket_id = ? ORDER BY month`, [reporter, basketId]))
  .map((d) => ({...d, month: new Date(d.month)}));
const latest = series.at(-1);
const yearAgo = series.find((d) => latest && d.month.getUTCFullYear() === latest.month.getUTCFullYear() - 1 && d.month.getUTCMonth() === latest.month.getUTCMonth());
const supRows = rows(await db.query(`SELECT * FROM sup WHERE reporter = ? AND basket_id = ? ORDER BY month`, [reporter, basketId]))
  .map((d) => ({...d, month: new Date(d.month)}));
const shareKey = ttm ? "share_12m" : "share";
const top1 = ttm ? latest?.top1_iso3_12m : latest?.top1_iso3;
```

<div class="grid grid-cols-4">
  <div class="card kpi"><div class="sub">Imports, ${latest ? monthFmt(latest.month) : "–"}</div><div class="big">${eur(latest?.imports_eur)}</div><div class="sub">${yearAgo ? `${latest.imports_eur >= yearAgo.imports_eur ? "+" : ""}${pct(latest.imports_eur / yearAgo.imports_eur - 1)} vs ${monthFmt(yearAgo.month)}` : "no year-earlier month"}</div></div>
  <div class="card kpi"><div class="sub">Largest supplier${ttm ? " (12 months)" : ""}</div><div class="big">${pct(ttm ? latest?.top1_share_12m : latest?.top1_share)}</div><div class="sub">${nameOf.get(top1) ?? top1 ?? "–"}</div></div>
  <div class="card kpi"><div class="sub">Concentration (HHI)${ttm ? ", 12 months" : ""}</div><div class="big">${(ttm ? latest?.hhi_12m : latest?.hhi)?.toFixed(2) ?? "–"}</div><div class="sub">0 = dispersed · 1 = single supplier</div></div>
  <div class="card kpi"><div class="sub">Suppliers, ${latest ? monthFmt(latest.month) : "–"}</div><div class="big">${latest?.supplier_count ?? "–"}</div><div class="sub">partner countries with recorded imports</div></div>
</div>

```js
const valid = supRows.filter((d) => d[shareKey] != null);
const top6 = d3.groupSort(valid, (g) => -d3.sum(g, (d) => (ttm ? d.value_eur_12m : d.value_eur)), (d) => d.partner_iso3).slice(0, 6);
const mix = d3.flatRollup(valid, (g) => d3.sum(g, (d) => d[shareKey]), (d) => d.month, (d) => (top6.includes(d.partner_iso3) ? nameOf.get(d.partner_iso3) ?? d.partner_iso3 : "All others"))
  .map(([month, supplier, v]) => ({month, supplier, v}));
const order = [...top6.map((c) => nameOf.get(c) ?? c), "All others"];
```

<div class="grid grid-cols-2">
<div class="card">

### Supplier mix${ttm ? " (trailing 12 months)" : " (monthly)"}

```js
display(resize((width) => Plot.plot({
  width, height: 320, x: {label: null, type: "utc"}, y: {label: "↑ Share of imports", tickFormat: "%", grid: true},
  color: {legend: true, domain: order, range: [...d3.schemeTableau10.slice(0, top6.length), "#bab0ac"]},
  marks: [Plot.areaY(mix, Plot.stackY({order}, {x: "month", y: "v", fill: "supplier", curve: "step", tip: true, title: (d) => `${d.supplier} · ${monthFmt(d.month)}\n${pct(d.v)}`}))]
})));
```

</div>
<div class="card">

### Concentration over time

```js
const conc = series.flatMap((d) => [
  {month: d.month, metric: "HHI", v: ttm ? d.hhi_12m : d.hhi},
  {month: d.month, metric: "Largest supplier share", v: ttm ? d.top1_share_12m : d.top1_share}
]).filter((d) => d.v != null);
display(resize((width) => Plot.plot({
  width, height: 320, x: {label: null, type: "utc"}, y: {label: "↑ Index / share", domain: [0, 1], grid: true},
  color: {legend: true, domain: ["HHI", "Largest supplier share"], range: ["#4269d0", "#c08a1e"]},
  marks: [Plot.lineY(conc, {x: "month", y: "v", stroke: "metric", curve: "step-after", tip: true})]
})));
```

</div>
</div>

<div class="card">

### Suppliers, ${latest ? monthFmt(latest.month) : ""}

```js
const lastRows = supRows.filter((d) => latest && +d.month === +latest.month).sort((a, b) => b.value_eur - a.value_eur);
display(Inputs.table(lastRows.map((d) => ({
  Supplier: nameOf.get(d.partner_iso3) ?? d.partner_iso3, ISO3: d.partner_iso3,
  "Value (EUR)": d.value_eur, "Share (month)": d.share, "Share (12 months)": d.share_12m, "Quantity (100 kg)": d.qty_100kg
})), {rows: 12, layout: "auto", format: {"Value (EUR)": (x) => Math.round(x).toLocaleString("en-US"), "Share (month)": pct, "Share (12 months)": pct, "Quantity (100 kg)": (x) => (x == null ? "–" : Math.round(x).toLocaleString("en-US"))}}));
```

</div>

<p class="muted">Import values as declared by EU member states (Eurostat customs statistics, EUR, current prices). They are not reconciled with exporters' reports the way BACI is, so levels and shares can differ from the annual pages. Single months are noisy; the trailing-12-month view sums the latest 12 months. Taiwan is shown as "Other Asia, nes (incl. Taiwan)" for consistency with BACI. Source: Eurostat, Comext DS-045409, © European Union, adapted by TradeGraph AI. Monthly US data (US Census Bureau) will be added when an API key is configured.</p>
