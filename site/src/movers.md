---
title: Biggest movers
---


# Where did dependency change most?

```js
const info = FileAttachment("data/build_info.json").json();
const db = DuckDBClient.of({
  mi: FileAttachment("data/movers_importer.parquet"),
  ms: FileAttachment("data/movers_supplier.parquet")
});
const NAME_OVERRIDE = {S19: "Other Asia, nes (incl. Taiwan)"};
const cname = (iso3, name) => NAME_OVERRIDE[iso3] ?? name;
const usd = (k) => { const v = k * 1e3; return v >= 1e9 ? `$${(v / 1e9).toFixed(1)} bn` : `$${(v / 1e6).toFixed(0)} m`; };
const pp = (x) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} pp`;
const rows = (r) => Array.from(r, (d) => ({...d}));
```

```js
const mv = info.movers;
const win = (w) => `${w[0]}–${w[1]}`;
const labelOf = new Map(info.baskets.map((b) => [b.id, b.label]));
const basketChoice = view(Inputs.select([null, ...info.baskets.map((b) => b.id)], {label: "Basket", format: (id) => (id ? labelOf.get(id) : "All baskets"), value: null}));
```

<div class="chips">
  <span class="chip obs">OBSERVED</span>
  <span class="chip">CEPII BACI · ${info.source.hs_revision} · V${info.source.release}</span>
  <span class="chip">Averages ${win(mv.start_years)} vs ${win(mv.end_years)}</span>
  <span class="chip">Only pairs with ≥ ${usd(mv.min_imports_kusd)}/yr imports in both windows and data in every year</span>
</div>

<p class="muted">Each figure is an average over the window years. HHI runs from near 0 (many suppliers) to 1 (a single supplier). A change in concentration describes the data; it doesn't say why it changed. Open a pair in the <a href="./profile.html">Dependency profile</a> to see its full history before drawing any conclusion.</p>

```js
const short = (s, n = 26) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const imp = rows(await db.query(`SELECT * FROM mi ${basketChoice ? "WHERE basket_id = ?" : ""}`, basketChoice ? [basketChoice] : []))
  .map((d) => ({...d, basket: labelOf.get(d.basket_id), importer: cname(d.importer_iso3, d.importer_name)}))
  .map((d) => {
    const b = info.baskets.find((x) => x.id === d.basket_id);
    const sl = b.short_label ?? short(b.label, 16);
    return {...d, keyWide: `${short(d.importer, 22)} · ${sl}`, keyNarrow: `${d.importer_iso3} · ${sl}`};
  });
const up = d3.sort(imp, (d) => -d.delta_hhi).slice(0, 15);
const down = d3.sort(imp, (d) => d.delta_hhi).slice(0, 15);
const bars = (data, title) => resize((width) => { const key = width < 560 ? "keyNarrow" : "keyWide"; return Plot.plot({
  title, width: Math.max(width, 300), marginLeft: width < 560 ? 120 : 220, height: 24 * data.length + 50,
  x: {label: "Change in HHI →", grid: true},
  y: {label: null, domain: data.map((d) => d[key])},
  marks: [
    Plot.barX(data, {y: key, x: "delta_hhi", fill: (d) => (d.delta_hhi >= 0 ? "#c46b52" : "#4269d0"),
      tip: true, title: (d) => `${d.importer} · ${d.basket}\nHHI ${d.start_hhi.toFixed(2)} → ${d.end_hhi.toFixed(2)}\nImports ${usd(d.start_imports_kusd)} → ${usd(d.end_imports_kusd)} per year`}),
    Plot.ruleX([0])
  ]
}); });
```

<div class="grid grid-cols-2">
<div class="card">${bars(up, "Most concentrated over time")}</div>
<div class="card">${bars(down, "Most diversified over time")}</div>
</div>

```js
const sup = rows(await db.query(`SELECT * FROM ms ${basketChoice ? "WHERE basket_id = ?" : ""} ORDER BY abs(delta_share) DESC LIMIT 300`, basketChoice ? [basketChoice] : []))
  .map((d) => ({
    Basket: labelOf.get(d.basket_id),
    Importer: d.importer_iso3,
    Supplier: cname(d.supplier_iso3, d.supplier_name),
    [`Share ${win(mv.start_years)}`]: d.start_share,
    [`Share ${win(mv.end_years)}`]: d.end_share,
    Change: d.delta_share,
    "Years with data": `${d.years_present_start} / ${d.years_present_end}`
  }));
const pctf = (x) => `${(100 * x).toFixed(1)}%`;
```

<div class="card">

### Largest supplier-share shifts

<span class="muted">The supplier's share of the importer's recorded imports, averaged over each window. A year with no recorded flow counts as 0% share. "Years with data" shows how many years in each window had a flow.</span>

```js
display(Inputs.table(sup, {rows: 15, layout: "auto", format: {[`Share ${win(mv.start_years)}`]: pctf, [`Share ${win(mv.end_years)}`]: pctf, Change: pp}}));
```

</div>

```js
const full = d3.sort(imp, (d) => -Math.abs(d.delta_hhi)).map((d) => ({
  Basket: d.basket, Importer: d.importer, ISO3: d.importer_iso3,
  [`HHI ${win(mv.start_years)}`]: d.start_hhi, [`HHI ${win(mv.end_years)}`]: d.end_hhi, "Δ HHI": d.delta_hhi,
  [`Top-1 ${win(mv.start_years)}`]: d.start_top1_share, [`Top-1 ${win(mv.end_years)}`]: d.end_top1_share,
  [`Imports/yr ${win(mv.end_years)}`]: usd(d.end_imports_kusd)
}));
```

<div class="card">

### All pairs (${imp.length})

```js
display(Inputs.table(full, {rows: 12, layout: "auto", format: {
  [`HHI ${win(mv.start_years)}`]: (x) => x.toFixed(3), [`HHI ${win(mv.end_years)}`]: (x) => x.toFixed(3), "Δ HHI": (x) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`,
  [`Top-1 ${win(mv.start_years)}`]: pctf, [`Top-1 ${win(mv.end_years)}`]: pctf
}}));
const csv = d3.csvFormat(full);
display(html`<a download="tradegraph_movers.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(csv)}">Download CSV</a>`);
```

</div>
