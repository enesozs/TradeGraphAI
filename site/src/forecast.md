---
title: Forecast lab
---


# Can next year's trade links be predicted better than "same as last year"?

```js
const info = FileAttachment("data/build_info.json").json();
const fm = FileAttachment("data/forecast_metrics.json").json();
const db = DuckDBClient.of({p: FileAttachment("data/forecast_predictions.parquet")});
```

```js
const NAME_OVERRIDE = {S19: "Other Asia, nes (incl. Taiwan)"};
const rows = (r) => Array.from(r, (d) => ({...d}));
const LABEL = {persistence: "Persistence (last year)", mean3: "3-year mean", gravity: "Gravity (PPML)", ridge: "Ridge regression", gbm: "Gradient boosting", gbm_graph: "Gradient boosting + network", gbm_weighted: "Boosting, value-weighted †", gbm_delta: "Boosting on change †", gbm_delta_weighted: "Boosting on change, value-weighted †"};
const COLOR = {persistence: "#7f7f7f", mean3: "#bab0ac", gravity: "#c08a1e", ridge: "#59a14f", gbm: "#4269d0", gbm_graph: "#8a63d2", gbm_weighted: "#e15759", gbm_delta: "#76b7b2", gbm_delta_weighted: "#ff9da7"};
const models = fm.models;
const color = {domain: models.map((m) => LABEL[m]), range: models.map((m) => COLOR[m]), legend: true};
const usd = (k) => { const v = k * 1e3; return v >= 1e9 ? `$${(v / 1e9).toFixed(2)} bn` : `$${(v / 1e6).toFixed(1)} m`; };
const holdout = fm.folds.find((f) => f.role === "holdout");
const val = fm.folds.filter((f) => f.role === "validation");
```

<div class="chips">
  <span class="chip fc">FORECAST · model output</span>
  <span class="chip">CEPII BACI ${info.source.hs_revision} V${info.source.release}</span>
  <span class="chip">Retrospective backtest on revised data</span>
</div>

<p class="muted"><strong>Task:</strong> for each recorded supplier → importer link in a basket, predict its value next year using only data up to this year. This covers links recorded in both years; the share of links that disappear is shown separately. <strong>Error</strong> is the mean absolute error of log value: 0.10 ≈ 10% typical miss. <strong>Skill</strong> is the error reduction against persistence: positive is better, negative is worse. The ${holdout.target_year} holdout was evaluated once, after every modelling choice was fixed. BACI revises past data, so this test is retrospective: real-time forecasts would face older, less complete data and a publication lag of about a year.</p>

```js
const years = d3.range(info.years[0], info.years.at(-1) + 1);
const ribbon = fm.folds.flatMap((f) => years.map((y) => ({
  fold: `Target ${f.target_year}${f.role === "holdout" ? " (holdout)" : ""}`, year: y,
  kind: y <= f.target_year - 2 ? "Training (features + targets)" : y === f.target_year - 1 ? "Features for test" : y === f.target_year ? (f.role === "holdout" ? "Holdout target" : "Validation target") : "Unused"
})));
```

<div class="card">

### Chronological folds

```js
display(resize((width) => Plot.plot({
  width, height: 40 + 26 * fm.folds.length, marginLeft: 140,
  x: {label: null, tickFormat: "d", ticks: years.filter((y) => y % 2 === 0)},
  y: {label: null},
  color: {legend: true, domain: ["Training (features + targets)", "Features for test", "Validation target", "Holdout target", "Unused"], range: ["#9db4e6", "#4269d0", "#8a63d2", "#c46b52", "var(--theme-foreground-faintest)"]},
  marks: [Plot.cell(ribbon, {x: "year", y: "fold", fill: "kind", inset: 1, tip: true})]
})));
```

</div>

```js
const perFold = fm.folds.flatMap((f) => models.map((m) => ({target: f.target_year, model: LABEL[m], mae: f.models[m].mae_log, skill: f.models[m].skill_vs_persistence, role: f.role})));
```

<div class="grid grid-cols-2">
<div class="card">

### Error by fold (lower is better)

```js
display(resize((width) => Plot.plot({
  width, height: 300, x: {label: "Target year", tickFormat: "d"}, y: {label: "↑ MAE (log value)", grid: true, zero: true}, color,
  marks: [
    Plot.ruleX([holdout.target_year - 0.5], {stroke: "currentColor", strokeOpacity: 0.3, strokeDasharray: "3,3"}),
    Plot.lineY(perFold, {x: "target", y: "mae", stroke: "model"}),
    Plot.dot(perFold, {x: "target", y: "mae", stroke: "model", fill: (d) => (d.role === "holdout" ? "model" : "var(--theme-background)"), tip: true})
  ]
})));
```

<span class="muted">The dashed line separates the validation folds from the holdout year, whose points are filled.</span>

</div>
<div class="card">

### Skill vs persistence by fold

```js
display(resize((width) => Plot.plot({
  width, height: 300, x: {label: "Target year", tickFormat: "d"}, y: {label: "↑ Skill (error reduction vs persistence)", tickFormat: "+%", grid: true}, color,
  marks: [Plot.ruleY([0]), Plot.lineY(perFold, {x: "target", y: "skill", stroke: "model"}), Plot.dot(perFold, {x: "target", y: "skill", stroke: "model", tip: true})]
})));
```

</div>
</div>

```js
const summaryRows = (role) => models.map((m) => {
  const v = fm.breakdown[role].pooled[m], p = fm.breakdown[role].pooled.persistence;
  return {Model: LABEL[m], "MAE (log)": v.mae_log, "RMSE (log)": v.rmse_log, "WAPE (USD)": v.wape_usd, Bias: v.bias_log, Skill: 1 - v.mae_log / p.mae_log, n: v.n};
});
const fmtS = {"MAE (log)": (x) => x.toFixed(3), "RMSE (log)": (x) => x.toFixed(3), "WAPE (USD)": (x) => `${(100 * x).toFixed(1)}%`, Bias: (x) => x.toFixed(3), Skill: (x) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}%`, n: (x) => x.toLocaleString("en-US")};
```

<div class="grid grid-cols-2">
<div class="card">

### Validation folds ${val[0].target_year}–${val.at(-1).target_year}, pooled

```js
display(Inputs.table(summaryRows("validation"), {layout: "auto", format: fmtS, sort: "MAE (log)"}));
```

</div>
<div class="card">

### Holdout ${holdout.target_year}

```js
display(Inputs.table(summaryRows("holdout"), {layout: "auto", format: fmtS, sort: "MAE (log)"}));
```

<span class="muted">† Added after the ${holdout.target_year} holdout had been evaluated, so its holdout score is <strong>post hoc</strong>, not a clean test. Its validation-fold scores are fair. A clean test needs ${holdout.target_year + 1}, once a later BACI release finalises it. ${(100 * holdout.disappearance_rate).toFixed(1)}% of links recorded in ${holdout.target_year - 1} were not recorded in ${holdout.target_year}. They are outside this benchmark.</span>

</div>
</div>

```js
const sizes = ["< $1 m", "$1–10 m", "$10–100 m", "≥ $100 m"];
const bySize = Object.entries(fm.breakdown.holdout.by_size).map(([k, v]) => { const [size, m] = k.split("|"); return {size, model: LABEL[m], mae: v.mae_log, n: v.n}; });
```

<div class="card">

### Holdout error by link size (value in year t)

```js
display(resize((width) => Plot.plot({
  width, height: 280, x: {axis: null, domain: models.map((m) => LABEL[m])}, y: {label: "↑ MAE (log value)", grid: true},
  fx: {label: null, domain: sizes}, color,
  marks: [Plot.barY(bySize, {fx: "size", x: "model", y: "mae", fill: "model", tip: true, title: (d) => `${d.model} · ${d.size}\nMAE ${d.mae.toFixed(3)} · n ${d.n.toLocaleString("en-US")}`}), Plot.ruleY([0])]
})));
```

<span class="muted">Small links are much noisier. Most of the value sits in the largest links, where all models do best.</span>

</div>

<div class="card">

### Explore one link

```js
const links = rows(await db.query(`SELECT basket_id, importer_iso3, exporter_iso3, max(actual_kusd) AS mx FROM p GROUP BY ALL ORDER BY mx DESC LIMIT 400`));
const pick = view(Inputs.select(links, {label: "Link", format: (d) => `${d.exporter_iso3} → ${d.importer_iso3} · ${info.baskets.find((b) => b.id === d.basket_id)?.short_label ?? d.basket_id}`}));
```

```js
const series = rows(await db.query(`SELECT * FROM p WHERE basket_id = ? AND importer_iso3 = ? AND exporter_iso3 = ? ORDER BY target_year`, [pick.basket_id, pick.importer_iso3, pick.exporter_iso3]));
const actual = d3.groups(series, (d) => d.target_year).map(([y, g]) => ({year: y, v: g[0].actual_kusd}));
display(resize((width) => Plot.plot({
  width, height: 300, marginLeft: 72, x: {label: "Target year", tickFormat: "d"}, y: {label: "↑ Value", tickFormat: (d) => usd(d), grid: true}, color,
  marks: [
    Plot.lineY(actual, {x: "year", y: "v", stroke: "currentColor", strokeWidth: 2.5}),
    Plot.dot(actual, {x: "year", y: "v", fill: "currentColor", r: 3.5, title: (d) => `Observed ${d.year}: ${usd(d.v)}`, tip: true}),
    Plot.dot(series, {x: "target_year", y: "pred_kusd", stroke: (d) => LABEL[d.model], r: 3, tip: true, title: (d) => `${LABEL[d.model]} · ${d.target_year}: ${usd(d.pred_kusd)}`})
  ]
})));
```

<span class="muted">The black line is observed. The coloured points are each model's forecast for that year, made with data from the year before. Only links worth at least $10 m are listed.</span>

</div>
