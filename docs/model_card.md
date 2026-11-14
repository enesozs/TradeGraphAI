# Model card: gravity baseline and forecast models

## 1. Gravity baseline (M3, ADR-006)

- **Purpose:** an "expected trade" reference, so that network centrality can be read relative to size and geography. It is **not** a causal model and **not** a forecaster.
- **Specification:** PPML (`pyfixest.fepois`), one fit per basket on all country pairs × years 2012–2024:
  - covariates: log distance, shared border, common official language, colonial tie (ever), trade agreement in force, covariate-imputed indicator
  - fixed effects: exporter-year and importer-year
  - standard errors clustered by country pair
- **Assumptions:**
  - Unrecorded pairs count as zero inside the model only.
  - Trade-agreement status after 2021 is carried forward, so RCEP's 2022 links are missed.
  - S19 uses Taiwan's covariates.
  - Missing binary covariates are filled from the reverse pair, otherwise 0 with an indicator.
- **Quality:**
  - Correlation of fitted with observed positive flows: 0.82–0.99 by basket.
  - Unpredicted observed value: 0.0% (the build fails above 0.1%).
  - Robustness: excluding the smallest 10% of economies leaves expected supplier shares unchanged (correlation 1.000).
- **Don't use it for:** forecasting individual links (it scores −82% skill vs persistence), or causal claims about distance, language or agreements.

## 2. Forecast models (M4, ADR-007)

- **Task:** log(1 + next-year value) for supplier → importer basket links recorded in both years.
- **Models:**
  - baselines: persistence, 3-year mean, gravity
  - learned: Ridge, histogram gradient boosting (± network features)
  - post hoc: value-weighted and change-target variants
- **Evaluation:** expanding-window folds (targets 2017–2022), holdout 2023 (now spent), retrospective on revised data.

| Headline (validation, pooled) | MAE (log) | Skill | WAPE (USD) |
|---|---|---|---|
| Persistence | 0.902 | 0 | 22.4% |
| Boosting on change † | 0.857 | +5.0% | 22.9% |
| Boosting + network (original) | 0.860 | +4.6% | 45.3% |

† Post hoc: chosen after the holdout was seen.

- **Intended use:** research comparison of forecasting approaches; showing how hard persistence is to beat.
- **Not for:** operational decisions, trade policy, or individual-link predictions without uncertainty. No prediction intervals yet.
- **Known failure modes:**
  - Level-target models shrink large links toward the mean.
  - Small links (< $1 m) are very noisy (MAE ≈ 1.0 in log terms).
  - About 19% of links disappear each year and are outside the task.
- **Reproducibility:** fixed seeds and deterministic features. Metrics repeat to all displayed digits; the multithreaded gravity fits differ only at the ~1e-15 level.
