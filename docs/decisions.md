# Architecture & Research Decision Log

Short ADRs. Status values: **Proposed** (not yet validated by evidence), **Accepted**, **Superseded**. Each decision states what would make us revisit it.

---

## ADR-001 — Product wedge: dependency & exposure first

**Status:** Accepted (2026-11-05)

**Context.** Free tools (Harvard Atlas of Economic Complexity, OEC, WITS, ITC TradeMap, Comtrade UI) already let people browse bilateral trade on maps and networks. A generic "trade explorer" would duplicate them.

**Decision.** TradeGraph's core is the **importer × product dependency profile**:
- how concentrated a country's supply of a product is
- how that concentration changes over time
- how much of a supplier's volume could plausibly be replaced, given what alternative suppliers already export elsewhere

Every number carries explicit denominators, coverage and provenance. Maps, networks, forecasts and the AI analyst are supporting views, added only when they serve this question.

**Revisit if.** User feedback or a published finding shows a different question is more valuable.

---

## ADR-002 — Primary data source: CEPII BACI (HS12)

**Status:** Accepted (2026-11-06). The owner chose it after comparing it with Comtrade, the Atlas, ITC Trade Map, WITS, OEC, Comext/US Census and IMF DOTS. **Window: 2012–2024**, for BACI and World Bank GDP alike.

**Licence compliance (checked 2026-11-06):**
- **BACI and CEPII Gravity** (Etalab 2.0): cite both.
- **World Bank WDI** (CC BY 4.0): cite the World Bank; don't imply its endorsement.
- **WTO RTA data:** non-commercial use with citation; don't republish the raw tables.
- **UN Comtrade:** private spot checks only; never store or publish its data.
- Recheck all of these if the project becomes commercial.

**Context.** The original candidates were the Harvard Atlas and UN Comtrade.
- **Comtrade.** Raw reporter data includes mirror duplicates and CIF/FOB mismatches. Free tier: 500 calls/day. Re-disseminating original data requires a premium subscription.
- **Atlas.** Reconciled, but its licence differs per file and must be checked file by file.

**Decision.** Use **CEPII BACI** as the primary source:
- **Reconciliation.** A single reconciled exporter→importer flow per HS6 product and year. CIF costs are removed from imports and reporters are weighted by reliability.
- **Data.** Values in thousands of current USD and quantities in metric tonnes.
- **Licence.** Etalab Open Licence 2.0: any use is allowed with attribution.

Use the **HS12** revision. It covers 2012–2024 in release V202601, so the 2015–2024 analysis window uses a single classification and needs no cross-revision merging. HS17 starts only in 2017.

**Known facts (checked 2026-11-05 against CEPII pages):**
- **Release.** V202601 (published 2026-01-30). BACI is updated every January, and the last year is provisional and may be revised.
- **File.** `BACI_HS12_V202601.zip` is 1,267,950,839 bytes. The server supports HTTP range requests, so individual year files can be extracted without downloading the whole zip.
- **Data rules.** Only strictly positive flows are recorded (absent ≠ zero). Country codes are ISO numeric. Product codes must be read as strings.
- **Versions.** Never mix BACI versions.

**Fallbacks.** Harvard Atlas bilateral tables; UN Comtrade API for validation spot checks.

**Revisit if.** M0 sample checks fail to reconcile with independent published totals, or the licence terms differ from the published page.

---

## ADR-003 — Product granularity: curated HS4/HS6 baskets

**Status:** Accepted (2026-11-06).

**Must be easy to change.** The pipeline stores **all** HS6 products for every year. Baskets are applied only when the marts are built, so editing `configs/baskets.yaml` and running `uv run tradegraph marts` produces results for a new list with nothing re-downloaded. The loader validates the file strictly:
- product codes must be quoted 6-digit strings
- codes must exist in the BACI product list
- basket ids must be unique

A future app can reuse the same mechanism for user-defined baskets.

**Context.** HS2 chapters are too coarse for dependency analysis. For example, HS 85 mixes semiconductors with household appliances.

**Decision.** The MVP works with **3–5 curated product baskets** defined at HS4/HS6 in HS12 codes, kept in `configs/baskets.yaml`. Each basket records its rationale and code list, and notes codes that split or merged in later HS revisions. Analysis covers **all reporting countries**: shares and HHI are always computed against all partners. The UI may feature a shortlist of focal importers.

**Revisit if.** Basket results are dominated by classification artifacts, or users need full HS6 browsing.

---

## ADR-004 — Delivery architecture: static-first analytics site

**Status:** Accepted (2026-11-06). The site uses **Observable Framework 1.13**.
- **Why:** full control over custom visuals, with DuckDB-WASM and Observable Plot built in, and data loaders that read the marts directly. Evidence is better suited to standard BI dashboards.
- **Risk:** Framework's release cadence has slowed (last release April 2026). Because the marts are plain Parquet, switching frameworks would mean rewriting only the pages.

**Context.** The original plan was FastAPI + Streamlit, with a later React rewrite for ambitious visuals. That plan has two problems:
- It means two serving layers for a single-user MVP.
- Streamlit cannot deliver the visual language in `docs/VISUAL_DESIGN.md`.

**Decision.** The Python pipeline precomputes versioned **Parquet marts**. A **static site** reads them in the browser with **DuckDB-WASM**, using **Mosaic / vgplot** (or Observable Plot) for linked, filterable views. This has three benefits:
- Hosting is free (GitHub Pages / Cloudflare Pages).
- There is a shareable demo link from the first slice.
- There is no server to secure.

The leading candidate for the site framework is Observable Framework. Alternatives are Evidence or Vite + Svelte/React; the M1 spike picks one and records why.

A server API (FastAPI) is added only when a feature truly needs server compute, for example scenario optimization over large inputs or the AI analyst.

**Revisit if.** Mart sizes exceed comfortable browser limits (roughly 50–100 MB per view), or interactive features need server-side computation.

---

## ADR-005 — Forecasting benchmark includes structural gravity

**Status:** Accepted (2026-11-05).

**Context.** The original forecasting plan compared persistence, Ridge and GBM, and left out the field's standard model of bilateral trade.

**Decision.** The forecast benchmark includes a **PPML gravity model** using `pyfixest`, with covariates from the **CEPII Gravity** database: distance, contiguity, common language, RTAs and GDP.

**Coverage gap (verified 2026-11-05).** CEPII Gravity V202211 covers only 1948–2020, while our window runs to 2024.
- Pair attributes that don't change over time (distance, contiguity, language, colonial ties) come from Gravity.
- Yearly GDP comes from World Bank WDI.
- Trade-agreement status after 2020 comes from the WTO RTA database.
- Each bridged variable is documented in `docs/source_inventory.md`. The benchmark compares persistence, gravity, GBM, and GBM with graph features. All evaluation is chronological. The benchmark's results are reported regardless of which model wins. Gravity-expected flows also serve as the **null model** for network centrality, so that "central" means more than "large".

**Revisit if.** Gravity covariates are unavailable for the chosen window.

---

## ADR-006 — Gravity baseline as implemented in M3

**Status:** Accepted (2026-11-06). Supersedes the WTO-RTA and WDI-GDP parts of ADR-005.

- **Specification.** PPML with exporter-year and importer-year fixed effects; covariates log distance, shared border, common official language, colonial tie (ever) and trade agreement in force. The fixed effects absorb GDP and every other country-year factor, so **WDI GDP isn't needed** for the baseline. It stays downloaded for M4.
- **Zeros (owner-approved).** Inside the gravity model only, country pairs with no recorded BACI flow count as zero, because PPML needs them. Everywhere else, missing still means "not recorded".
- **Trade agreements after the data ends.** CEPII Gravity's agreement field runs to 2021. 2022–2024 carry the 2021 status forward rather than using the WTO list, which keeps the inputs simpler and avoids WTO data terms. Agreements that start after 2021, notably RCEP's new China–Japan and Japan–Korea links in 2022, are not captured.
- **Missing covariates.** Gravity leaves border, language or colonial-tie values missing for some pairs (e.g. China→Hong Kong language). They are filled from the reverse pair, otherwise set to 0 with a `cov_missing` indicator. Without this, pyfixest silently dropped those rows, including the world's largest chip flow (China→Hong Kong). A **guard** now fails the build if more than 0.1% of observed value gets no prediction.
- **Taiwan.** BACI's "Other Asia, nes" (S19) takes Taiwan's covariates.
- **What the baseline can and can't say.** With country-year effects, PPML reproduces every country's total exports and imports exactly. The information is in the *distribution* across partners: expected supplier shares and centrality on the expected network.
- **Robustness (M3).** Re-estimating without the smallest 10% of economies by trade changes coefficients by less than 0.01, and expected supplier shares correlate at 1.000 with the main run.

---

## ADR-007 — Forecast benchmark as implemented in M4

**Status:** Accepted (2026-11-06).

- **Task.** Predict log(1 + next-year value) for links recorded in t and t+1; disappearance rate reported separately. Validation folds target 2017–2022; **holdout target 2023, now spent** (evaluated once on 2026-11-06). 2024 is never a target while it's provisional.
- **Models.** Persistence, 3-year mean, gravity (PPML refit on years ≤ t), Ridge, gradient boosting, gradient boosting + network features. Fixed hyperparameters. Boosting uses scikit-learn's `HistGradientBoostingRegressor`, which needs no native OpenMP library (unlike LightGBM).
- **No look-ahead.** Gravity-expected values used as features for year t come from fits on years ≤ t only. A unit test perturbs future data and asserts that year-t features don't change.
- **Result.** In log error, boosting beats persistence by about 4–6% in every fold. Value-weighted (WAPE), persistence wins. Network features add only about 0.2 points. Full write-up: `reports/m4_forecast/benchmark.md`.
- **Next experiment rule.** Model changes prompted by these results, such as value-weighted training, must be judged on a **new** holdout (2024, once a later BACI release finalises it), never on 2023.
- **Post-hoc variants (2026-11-06, owner request).** Value-weighted boosting, boosting on the change, and boosting on the change with value weights were added after the holdout. They're flagged `post_hoc_models` in `forecast_metrics.json` and marked † on the site. Best on validation: boosting on the change (+5.0% log skill; WAPE 22.9% vs persistence 22.4%). The candidate to test cleanly on 2024.

---

## ADR-008 — L2 Scenario Studio: capacity-constrained reallocation (precomputed)

**Status:** Accepted (2026-11-06).

**Setup.** Supplier *s* loses a fraction *f* of its exports to every importer. Alternatives can divert up to α of their total basket exports (Low 5% with no new links; Central 15%; High 30%; new links at half priority). Importers compete for that capacity.

**Allocation.** A two-stage linear program (scipy HiGHS):
1. Maximise the common fill rate across *servable* importers. Importers with no allowed supplier are excluded, since they would otherwise force the rate to 0 for everyone.
2. With that rate fixed, maximise weighted total reallocation, preferring existing links.

**Grid and uncertainty.** Every basket × its top-5 suppliers × shortfall {25, 50, 75, 100%} × 3 capacity settings, computed for 2023. Monte Carlo (100 draws, α ~ U(5%, 30%), new links with probability 0.5) gives p5–p95 bands at 50% and 100% shortfall. Everything is precomputed for the static site.

**Honesty.** Every output is labelled SCENARIO. α is an assumption, not measured spare capacity. Not modelled: prices, stocks, demand response, product mix within a basket, contracts, logistics, policy, knock-on effects.

## ADR-009 — L3: monthly EU data from Eurostat Comext; US data dormant until a key exists

**Status:** Accepted (2026-11-06).

- **Source.** Eurostat Comext DS-045409 (HS6, monthly), queried via the public SDMX API: ~28 queries, 1 s apart, raw CSVs checksummed.
- **Licence.** Eurostat reuse policy: reuse allowed with acknowledgement; adaptations must be flagged. Attribution: "Source: Eurostat (Comext DS-045409), © European Union; adapted by TradeGraph AI".
- **Coverage.** Importers EU27 (all partners), EU27 extra-EU, DE, FR, IT, NL, ES and PL, from January 2023 to the latest month (August 2026 at build time).
- **Mapping.** Partner codes map to BACI ISO3 (EL→GR, UK→GB, TW→S19). Aggregates such as WORLD and EXT_EU are excluded. A guard fails the build if unmapped country codes exceed 0.5% of value; currently below 0.02%.
- **Kept separate from BACI** (EUR, importer-declared, not reconciled). Never mixed with BACI in one figure.
- **US Census Bureau.** The API now needs a free key for every request and a "not endorsed" notice. An adapter (`tradegraph.ingestion.census`) is ready and activates once `CENSUS_API_KEY` is in a git-ignored `.env`.

## ADR-010 — L4 (indirect exposure) deferred

**Status:** Deferred by the owner (2026-11-06).

The OECD SDMX API returned HTTP 500 for the TiVA "origin of value added in final demand" dataflow (DSD_TIVA_FDVA@DF_FDVA, 1.1). The working alternative is a 1.5 GB bulk zip (2019–2022) that can't be range-read. OECD data has been under CC BY 4.0 since July 2024 (attribution required).

Revisit when the API works or the owner approves the bulk download.

## ADR-011 — Phase 2: modelled sea routes and IMF PortWatch chokepoints

**Status:** Accepted (2026-11-07).

**PortWatch licence.** The ArcGIS layers' `licenseInfo` points to the IMF Copyright and Usage terms (imf.org/en/about/copyright-and-terms). Under "Special Terms for Statistical Data", users may "download, extract, copy, create derivative works, publish, distribute, and use Data" on these conditions:
- **Attribution.** Credit the IMF, e.g. "Source: International Monetary Fund, PortWatch, <link>".
- **Integrity.** Don't distort the data. State any material transformation, e.g. "weekly averages of daily transit counts".
- **Commercial use.** Commercial reuse needs permission (copyright@imf.org).

TradeGraph is non-commercial and publishes only attributed, derived aggregates, so it complies. Raw files stay git-ignored. The terms also prohibit "bulk download of information by automated technology without explicit permission". Our files came through PortWatch's public, rate-limited query API. They are a one-off snapshot: the 80k-row transit table, plus 2,065 ports and 28 chokepoints. The app never queries IMF live. If in doubt, ask copyright@imf.org, or replace the snapshot with the CSV export from portwatch.imf.org.

**Route model.**
- **Network.** searoute 1.6 (Apache-2.0) over the Eurostat MARNET network, with the Northwest Passage closed.
- **Gateway ports.** Each country uses its top 3 ports by PortWatch share of the country's maritime imports plus exports. Ports more than 400 km from the network are dropped. The n-th port must be more than n × 3% shorter to beat the main port.
- **Routing.** A country pair's route is the shortest network path over all gateway-port combinations.
- **Chokepoints.** Passages are taken from searoute's edge tags. Eleven are modelled: Suez, Bab el-Mandeb, Hormuz, Malacca, Sunda, Panama, Gibraltar, Turkish Straits, Cape of Good Hope, Cape Horn/Magellan and Bering. The other 17 PortWatch chokepoints (e.g. Dover, Taiwan Strait) show traffic only.

**Mode classes** (a stated simplification: there is no global data on transport mode; ADR-014 adds observed modes for the EU):
- **`no_port`:** a landlocked or port-less side (1.6% of value). A guard fails the build if this exceeds 5%.
- **`neighbour`:** the countries are contiguous (CEPII). Assumed overland.
- **`overland_detour`:** the countries are less than 3,000 km apart, but the sea path is more than 2× the distance. Assumed overland.
- **`sea`:** everything else.

High value-per-kg goods (integrated circuits) largely fly, so exposure is shown in **tonnes first** and value second, with that caveat.

**Closures (SCENARIO).** Closing a chokepoint removes its edges and recomputes routes. Affected pairs either take an alternative path (we report extra km) or have no sea route at all (e.g. the Black Sea behind the Turkish Straits). Closures are computed for 2023, the latest final year. An invariant check fails the build if any closure-scenario load crosses the closed chokepoint. Nothing about cost, time, freight rates or prices is modelled.

## ADR-012: ML A, learned substitution capacity (2026-11-11)

**Decision.** Replace the Scenario Studio's fixed capacity assumption (alternatives divert 5% / 15% / 30% of their exports) with a learned, per-alternative expansion, kept next to the fixed options for comparison. "Learned" is the default capacity.

- **Training data:** supplier-specific falls across all HS6 products in CEPII BACI with at least $20 m of world trade, 2012–2024. A fall is a supplier's exports dropping by 30% or more in a year while world exports stay at 80% or more of the year before, for a supplier with at least 2% world share. That gives 73,577 falls and 1.87 m alternative rows. The target is each of the 40 largest alternatives' growth in the next year, measured in tonnes where both years report tonnes (95% of rows), otherwise in USD.
- **Model:** gradient boosting for the q10/q50/q90 of growth, plus the expected positive growth E[max(0, g)], which feeds the scenario LP's capacity. The q10–q90 band is widened by a factor calibrated on the last two training years. Monte Carlo draws use a common per-scenario factor, with the correlation (ρ) estimated from held-out residuals.
- **Backtest:** train on falls up to 2019, test on 31,517 falls from 2020–2024.
  - Total-expansion error: 9.2% learned, against 10.4% for the best fixed alternative (15%).
  - Coverage of the q10–q90 band: 78%.
  - On basket falls only (19 of them), the learned model is level with the fixed 5% (8.0% vs 7.5%).
- **Caveats, shown in the app:** the estimates are observational. Most past falls were smaller than the scenario shocks. The model is trained on HS6 products and applied to baskets.

## ADR-013: ML B, EU nowcast on the BACI basis; exchange-rate source (2026-11-11)

**Decision.** The owner chose option 3: nowcast the years BACI lacks (2025, and 2026 to the latest month published for every importer) for the EU only. That covers EU imports from outside the EU plus DE, FR, IT, NL, ES and PL, built from Eurostat Comext monthly data. No nowcast is made for non-EU importers.

- **Bridge:** Comext EUR values are converted to USD month by month, then a gradient-boosting model predicts the log BACI/Comext ratio. It uses the last known ratios, visible only up to the year minus the BACI lag, together with size, lag, reporter and basket. The part-year is scaled up by the median seasonal share from complete earlier years.
- **Backtest (2019–2024, lag-aware):**
  - Complete year: 4.8% median error on the yearly total, against 6.0% for Comext converted at the exchange rate.
  - Part-year (January–July): 10.7% against 11.5%.
  - The bands are the 10th–90th percentile of past errors.
- **Comext history:** extended back to 2017 (same dataset and licence, about 52 MB more).
- **New source: monthly USD/EUR rates.** These come from Eurostat `ert_bil_eur_m`, which is based on ECB reference rates. Under Eurostat's reuse policy, data owned by other sources, here the ECB, may be reused non-commercially with acknowledgement. The owner was informed and approved on 2026-11-11. Attribution: "Source: Eurostat (ert_bil_eur_m), based on ECB euro reference rates".

## ADR-014: ML F, EU-only observed transport mode (2026-11-11)

**Decision.** The owner chose to keep F to the EU, like B.
- **Dropped:** the US Census data, because it needs an API key registered with an organisation name, and US land trade only matters for Canada and Mexico.
- **Dropped:** Brazil's Comex Stat, because MDIC licenses it under CC BY-ND 3.0, which forbids derivatives.
- **Approach:** F uses **observed** data, not a model: the transport mode at the EU's external border.

**Source.** Eurostat Comext bulk folder TRANSPORT_HS (`trhs_v2_*`): per member state, partner, HS6 product, flow and transport mode, giving value in EUR and weight in kg.
- **Files:** yearly files 2012–2025 plus monthly files January–August 2026, 22 archives in all. They total 762.5 million bytes, which Eurostat lists as 727 MB. The owner approved the download on 2026-11-11.
- **Storage:** the raw archives are kept with checksums. The pipeline extracts each archive and keeps only imports of the basket products.
- **Licence:** Eurostat reuse policy, under which adapted data must be flagged and carry a non-responsibility disclaimer.

**Mode groups:**
- sea: sea and inland waterway
- air: air and post
- road
- rail
- other: fixed installations, own propulsion, and unknown

**Sea-route model.** For EU importers, each modelled sea flow is split by the observed sea share of the same importer, partner, basket and year.
- Only the sea part loads lanes, chokepoints and closures.
- The rest becomes the `eu_not_sea` mode class.
- Non-EU importers are unchanged: all their trade is assumed to go by sea, a caveat shown on the page.
- Example: in 2023 only 1% of EU chip imports from outside the EU arrived by sea (86% by air), so $37.8 bn of EU chip imports do not load sea lanes.

**Known gaps:**
- The mode is the one used at the EU border, so goods shipped by sea to a non-EU neighbour and then trucked into the EU count as road. For the UK this applies from 2020 only.
- The UK left the EU in 2020, and Eurostat treats it as a non-EU partner from 2020. For 2012–2019 its trade with member states was trade within the EU and is absent.
- About €1.3 bn of €766 bn falls under confidential or unspecified partner codes and is not mapped to a country.

**Country codes:**
- BACI's country file leaves Namibia's ISO2 code ("NA") blank. It is restored when BACI's country table is curated (`curate.load_dimensions`), so every ISO2 join sees it.
- Eurostat's own codes (EL Greece, UK United Kingdom, XS Serbia) are translated to ISO2 in one module, `eurostat_codes.py`, which also holds the EU27 list.

**Part-year:** the current year's rows all carry the number of months loaded for that year (`months`).

## ADR-015: Comext 12-month shares and partly published months (2026-11-12)

**Context.** Two things distort monthly supplier shares if left unhandled:
- **Partners absent in a month.** A partner may have no record in a given month but large imports over the trailing 12 months. If 12-month shares were computed only over the month's partners, the remaining ones would be inflated. Example: Italy's antibiotics in August 2026 would show China at 74% instead of 12%, because Switzerland's €389 m would drop out.
- **Partly published months.** Eurostat publishes a month before all of it is in. Its release of 16 October 2026 holds August 2026 for imports from outside the EU, but has no records of trade between member states for DE, FR, IT, NL, PL or the EU total. Spain's August is complete.

**Decision.**
- **12-month shares:** the supplier mart keeps one row per partner with imports in the month or in the trailing 12 months. For a partner with no record in the month, `value_eur` and `share` stay empty (not recorded, not zero).
- **Incomplete months:**
  - A reporter's month is incomplete when its intra-EU or extra-EU partner records, across all baskets, fall below 50% of its usual count.
    - The usual count is the median over the previous 12 months. At least 6 of those months are needed, and a usual count of at least 20 records; otherwise the month is not judged.
    - The usual count, rather than the same month a year earlier, still works for a reporter with no year-earlier month, and is not thrown by a single record of churn in a sparse month.
  - Measured against the usual count, complete months 2018–2026 stay between 0.79 and 1.20. The incomplete August is at 0.
  - Only the trailing run of such months is incomplete. Earlier months are treated as final.
- **Where incomplete months go:**
  - They are left out of both published marts, so no page or model has to filter them.
  - They are listed in `comext_info.json` (`incomplete_months`), together with each reporter's latest month.
  - The EU monthly page says which month is missing and why. The overview gives the latest month per importer.
  - The nowcast stops every importer at the same month: the last month published for all of them, which may fall in an earlier year (July 2026 at this build). Every earlier year is therefore complete for every importer.
- **File size:** `comext_supplier.parquet` stores values only. The page derives shares from them, which keeps the file at 2.7 MB.

