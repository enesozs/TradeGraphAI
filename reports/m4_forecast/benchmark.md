# Forecast benchmark: can we beat "same as last year"?

**TradeGraph AI · M4 · data: CEPII BACI HS12 V202601 · 6 product baskets · retrospective backtest**

## Summary

We predicted next year's value of every recorded supplier → importer link in six product baskets, using only data up to the current year. Six models were tested over six expanding-window validation folds (target years 2017–2022) and one untouched holdout year (2023, 23,302 links).

| Model | Holdout MAE (log) | Skill vs persistence | Holdout WAPE (USD) |
|---|---|---|---|
| Gradient boosting + network features | **0.920** | **+4.4%** | 40.2% |
| Gradient boosting | 0.922 | +4.2% | 39.3% |
| Ridge regression | 0.924 | +4.0% | **24.8%** |
| Persistence (last year's value) | 0.962 | 0 | 26.9% |
| 3-year mean | 0.971 | −0.9% | 31.7% |
| Gravity (PPML, refit on past data only) | 1.756 | −82.4% | 53.3% |

**Finding 1: in log terms the ML models win, but only modestly.** Gradient boosting reduced the typical log error by about 4–6% versus persistence in every validation fold and in the holdout. That's a consistent but small gain.

**Finding 2: in dollar terms persistence wins, except Ridge narrowly.** Weighting errors by trade value, persistence (26.9%) beats both boosting models (39–40%). The models were trained to minimise *log* error, which treats a $10 k link the same as a $10 bn link. They improve the many small, noisy links (68% of test links are under $1 m) and do worse on the few large links that carry most of the value:

| Link size (year t) | n | Persistence MAE | Boosting + network MAE |
|---|---|---|---|
| < $1 m | 18,416 | 1.045 | **0.993** |
| $1–10 m | 2,916 | 0.745 | **0.723** |
| $10–100 m | 1,377 | **0.563** | 0.567 |
| ≥ $100 m | 593 | **0.395** | 0.443 |

**Finding 3: network features add almost nothing.** Adding supplier/importer centrality and the gravity-expected value moved holdout skill from +4.2% to +4.4%. On this task, recent history of the link itself carries nearly all the predictive information.

**Finding 4: gravity is a structural benchmark, not a one-year forecaster.** The gravity model predicts the level a link "should" have given size and geography, not where it will be next year, so it loses badly to persistence (−82%). Its value is in the network view (M3), not here.

**Context:** about 19% of links recorded in one year are not recorded the next (19.4% for 2022→2023). Those links are outside this benchmark. Predicting which links appear or disappear is a separate task.

## Method

- **Target:** log(1 + value next year), in thousand USD, for links recorded in both years.
- **Features (year t and earlier only):**
  - the link's value in t, t−1 and t−2, plus 3-year mean and growth
  - the supplier's share of the importer's basket imports, the importer's HHI and supplier count
  - importer and exporter basket totals, and the exporter's world share
  - gravity covariates
  - network features: supplier and importer centrality in year t, and the gravity-expected value for year t from a PPML fit on years ≤ t
- **Folds:** for target year T, train on links whose target year is ≤ T−1 and test on links at year T−1. A test checks that changing any data after year t leaves year-t features unchanged.
- **Models:** fixed hyperparameters, no tuning. Gradient boosting is scikit-learn's `HistGradientBoostingRegressor`. LightGBM was planned but its macOS build needs `libomp`, which isn't available here; the two are equivalent in practice.
- **Holdout discipline:** 2023 was set aside before any model was run. The benchmark ran twice because of a bug in the predictions *export*. The second run produced identical metrics, and no modelling choice changed between runs.

## Limitations

- **Retrospective, not real-time.** BACI revises past years, so the training data is more complete than a forecaster at the time would have had. Real data also arrive about a year late, so a usable "next year" forecast is really a two- or three-year horizon.
- **Nominal values.** Price swings, especially in 2021–22, look like volume changes.
- **No prediction intervals yet**, so uncertainty isn't quantified per link.
- **Six baskets only.** Results may differ for other products.
- **Reproducibility:** results are deterministic up to floating-point noise (~1e-15) in the multithreaded gravity fits.

## What would improve it (future work, to be tested on a fresh holdout)

1. **Dollar-weighted training**, using sample weights proportional to link value, so large links matter as much in training as in the WAPE metric. The 2023 holdout has already been seen, so this must be judged on 2024 once a later BACI release finalises that year.
2. **Prediction intervals** (quantile boosting or conformal), reported with their coverage.
3. **A separate model for link appearance and disappearance.**

## Addendum: value-weighted and change-target models (post hoc, 2026-11-06)

These three variants were added **after** the 2023 holdout had been evaluated, prompted by Finding 2. Their validation-fold scores (2017–2022) are fair comparisons. Their 2023 scores are post hoc and are shown only for completeness.

| Model (validation 2017–2022, pooled) | MAE (log) | Skill | WAPE (USD) |
|---|---|---|---|
| Persistence | 0.902 | 0 | **22.4%** |
| **Boosting on change** (predict next − last, add back) | **0.857** | **+5.0%** | 22.9% |
| Boosting on change, value-weighted | 0.954 | −5.8% | 24.0% |
| Boosting, value-weighted (level target) | 1.828 | −102.7% | 27.6% |
| Boosting + network (original, level target) | 0.860 | +4.6% | 45.3% |

- **Value weighting alone helps dollar error (45% → 28%) but wrecks log error.** Small links get almost no weight in training.
- **Predicting the change rather than the level fixes most of the large-link problem.** Persistence becomes the model's anchor, so tree averaging no longer drags big links down. This variant has the best log error and nearly matches persistence in dollar terms.
- **Persistence still narrowly wins on links of $100 m or more** (MAE 0.330 vs 0.344). For the largest flows, last year's value remains the forecast to beat.

Iteration stopped here to avoid overfitting the validation folds. A clean test of "boosting on change" against persistence needs the 2024 data, once a later BACI release finalises it.

## Reproduce

```bash
uv run tradegraph all        # data, marts, gravity
uv run tradegraph forecast   # ~80 s; writes forecast_metrics.json and forecast_predictions.parquet
```

Every number above is in `data/marts/HS12_V202601/forecast_metrics.json`. The site's Forecast lab page shows the folds, per-fold errors and a link-by-link explorer.

*Source: CEPII BACI (Gaulier & Zignago, 2010), Etalab Open Licence 2.0. Covariates: CEPII Gravity V202211 (Etalab 2.0).*
