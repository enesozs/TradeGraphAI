---
title: Findings
---

# Findings

```js
import {usd} from "./components/observatory.js";
const fm = FileAttachment("data/forecast_metrics.json").json();
const db = DuckDBClient.of({movers: FileAttachment("data/movers_supplier.parquet")});
const pct = (x, d = 1) => (x == null ? "–" : `${(100 * x).toFixed(d)}%`);
```

```js
const ree = Array.from(await db.query(`SELECT importer_iso3, supplier_iso3, start_share, end_share, delta_share FROM movers
  WHERE basket_id = 'rare_earths_and_magnets' AND importer_iso3 IN ('DEU', 'USA')
  QUALIFY row_number() OVER (PARTITION BY importer_iso3 ORDER BY abs(delta_share) DESC) <= 4
  ORDER BY importer_iso3, abs(delta_share) DESC`), (d) => ({...d}));
const val = fm.breakdown.validation.pooled, hold = fm.breakdown.holdout.pooled;
```

<p class="muted">Each finding is reproducible from the pipeline. The full write-ups, with every number and its caveats, are in the project repository under <code>reports/</code>.</p>

<div class="card">

## 1. Germany and the US now buy about three-quarters of their rare-earth-and-magnet imports from China

<span class="chip obs">OBSERVED</span> <span class="chip">CEPII BACI HS12 V202601 · averages 2012–14 vs 2021–23</span>

```js
display(Inputs.table(ree.map((d) => ({Importer: d.importer_iso3, Supplier: d.supplier_iso3, "Share 2012–14": d.start_share, "Share 2021–23": d.end_share, Change: d.delta_share})),
  {layout: "auto", format: {"Share 2012–14": pct, "Share 2021–23": pct, Change: (x) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} pp`}}));
```

- **The shift is driven by permanent magnets**, which carry most of the basket's value. China's share of German magnet imports rose from 61% to 80% by value, and from 57% to 76% for the US.
- **Value and tonnes disagree for the US.** China's *tonnage* share of US magnet imports fell (88% → 74%) while its value share rose. That points to a product-mix or price change, consistent with more rare-earth (NdFeB) magnets, but the trade code can't confirm it.
- **Rare-earth materials move differently.** For Germany, China's share fell by value but rose by tonnes. With prices this volatile, value shares shouldn't be read alone.
- **Caveat:** code 850511 covers *all* metal magnets, not only rare-earth ones.

</div>

<div class="card">

## 2. Forecasting: "same as last year" is hard to beat where the money is

<span class="chip fc">FORECAST benchmark</span> <span class="chip">Retrospective, chronological folds 2017–2022, holdout 2023</span>

- **Log error:** gradient boosting beats persistence by about 4–6% in every fold (holdout MAE ${hold.gbm_graph.mae_log.toFixed(3)} vs ${hold.persistence.mae_log.toFixed(3)}).
- **Value-weighted error:** persistence wins (holdout WAPE ${pct(hold.persistence.wape_usd)} vs ${pct(hold.gbm_graph.wape_usd)}). The models gain on many small links and lose on the few large ones.
- **Predicting the change from last year** (added after the holdout, so validation only) comes closest. Its validation WAPE is ${pct(val.gbm_delta.wape_usd)} vs ${pct(val.persistence.wape_usd)} for persistence, with the best log error (+${pct(1 - val.gbm_delta.mae_log / val.persistence.mae_log)} skill). A clean test needs 2024 data once a later BACI release finalises it.
- **Network features add almost nothing**, and a gravity model is no one-year forecaster.

[Open the Forecast lab →](./forecast.html)

</div>

<div class="card">

## 3. The EU's lithium-ion battery imports from outside the EU are about 90% Chinese, and rising

<span class="chip obs">OBSERVED</span> <span class="chip">Eurostat Comext DS-045409 · monthly · EUR</span>

The trailing-12-month share rose from about 86% in early 2024 to about 90% by mid-2026, as the HHI climbed above 0.8. See the [EU monthly monitor](./eu-monthly.html) for the latest month. These are importer-declared EU statistics, not reconciled like BACI.

</div>
