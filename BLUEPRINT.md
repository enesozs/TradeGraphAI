# TradeGraph AI — Product & Research Blueprint

**Version:** 2.0 · **Status:** specification; no application exists yet · **Updated:** 2026-11-05

> **North star:** the most useful personal-scale, evidence-first tool for answering *"How dependent is country X on few suppliers for product P, how is that changing, and who could plausibly replace a supplier?"* Start with that question. Grow the product one verified layer at a time, and stop at any completed milestone.

Integrity rules live in [`AGENTS.md`](AGENTS.md). Visual specification is in [`docs/VISUAL_DESIGN.md`](docs/VISUAL_DESIGN.md). Decisions and their reasons are in [`docs/decisions.md`](docs/decisions.md).

## 1. Mission and wedge

Build an open **trade-dependency intelligence platform**. It combines reconciled bilateral trade data, concentration and exposure metrics, network analysis and forecasting. All of it sits behind interfaces that keep every number traceable to its source, denominator and coverage.

**Why this and not another trade explorer?** The Atlas, OEC, WITS and TradeMap already map trade flows. Few tools answer the *dependency* question rigorously:
- supplier shares against a complete denominator
- concentration trends
- **redirectable supply**: how much of the product alternative suppliers already ship to other destinations

(ADR-001)

**Two goals, in priority order:**
1. **A deployed, shareable dependency explorer** backed by a reproducible pipeline.
2. **At least one defensible published finding** written from it.

The project is also a learning vehicle for data engineering, economics, network science and ML. That goal is served by doing (1) and (2) well, not by the number of features.

## 2. Long-term vision (aspirational, not commitments)

A cinematic but truthful *economic observatory*. A researcher can zoom from a global overview to a product network to a single bilateral time series, then open forecasts and scenario comparisons without losing context. Candidate long-term modules, each gated by evidence that it adds value:

- **Living trade map/globe:** weighted statistical arcs, time-lapse of observed annual snapshots, product layers. Arcs are not shipping routes.
- **Network X-ray:** multilayer product graphs, communities, centrality **relative to a gravity-expected baseline**.
- **Country & product intelligence rooms:** exportable profiles with supplier mix, concentration, trends and coverage.
- **Forecast laboratory:** persistence vs gravity vs ML benchmarks, calibrated intervals, link formation/dissolution models.
- **Scenario studio:** compound hypothetical shortfalls, capacity-constrained reallocation, Monte Carlo sensitivity, saved comparisons.
- **Indirect exposure:** input-output linkage (e.g. OECD ICIO) for explicitly modeled downstream effects.
- **Evidence-grounded AI analyst:** turns natural-language questions into validated tool calls, with cited outputs. LLMs orchestrate and explain; they never calculate or serve as a fact source.
- **Anomaly observatory:** structural-break and data-quality alerts across releases.
- **Research workspaces:** saved views, provenance graphs, reproducible study exports.

**Product honesty boundary:** see AGENTS.md §Scientific contract. In short:
- Trade flows are not firm supply chains or shipping routes.
- Centrality is not indispensability.
- Scenarios are assumptions, not forecasts or causal estimates.

## 3. Users and research questions

**Users:** economics/trade researchers, policy and supply-chain analysts, students, data scientists.

**Core questions:**
1. How concentrated are importer × product sourcing relationships, and how do they evolve?
2. For a hypothetical supplier shortfall, what is the **direct exposure**, and how large is **observed redirectable supply** from the other suppliers?
3. How sensitive are these indicators to coverage, reconciliation, classification and price effects (nominal USD vs tonnes)?
4. Which trade links are central or anomalous *relative to what gravity predicts*?
5. Do temporal/graph features beat persistence and gravity in forecasting bilateral trade?

## 4. Data

### 4.1 Sources (candidates; evaluate on merit, don't treat this list as final)

| Role | Source | Notes |
|---|---|---|
| **Primary flows** | **CEPII BACI, HS12, V202601** | Reconciled HS6 bilateral flows, 2012–2024. Value in k USD plus quantity in tonnes. Etalab 2.0 licence. (ADR-002) |
| Gravity covariates / null model | CEPII Gravity V202211 (Etalab 2.0) + World Bank WDI + WTO RTA database | Gravity ends in **2020**. Use it for distance, contiguity, language and colonial ties; take yearly GDP from WDI and post-2020 RTAs from WTO. |
| Validation spot checks | UN Comtrade (UI/API free tier), WITS | Reconcile sample totals; raw reporter vs mirror comparisons. |
| Fallback flows | Harvard Growth Lab Atlas (Dataverse) | Licence must be checked per file. |
| Macro context | World Bank WDI API | GDP, population, deflators. |
| Later: finer / fresher data | Eurostat Comext (EU, monthly, CN8); US Census trade API (monthly, HS10) | For nowcasting and drill-down on EU/US importers. |
| Later: production capacity | USGS Mineral Commodity Summaries; IEA/IRENA where licensed | Basket-specific capacity proxies for scenarios. |
| Later: indirect exposure | OECD ICIO / TiVA | Input-output layer (Level L4). |

### 4.2 Scope

- **Window:** 2015–2024, all on HS12 (no cross-revision merging). The last year is provisional; flag it.
- **Countries:** **all** BACI reporters/partners in every computation. The UI may spotlight a shortlist of focal importers.
- **Products:** **3–5 curated baskets** at HS4/HS6 (ADR-003). Candidates include:
  - semiconductors / ICs
  - Li-ion batteries
  - PV cells/modules
  - pharmaceutical APIs / medicaments
  - rare-earth compounds
  - a control basket of an ordinary product

  Codes are verified in HS12 and stored in `configs/baskets.yaml` with rationale.

### 4.3 Gate G0 (must pass before pipeline code)

Document each of the following in `docs/source_inventory.md`:
- licence and attribution text
- release/version
- HS revision and years
- columns and units
- reconciliation method
- zero/missing semantics
- country-code scheme and special codes (e.g. 490 "Asia nes")
- file sizes and download method
- provisional-year behaviour

Reconcile 2–3 sample totals against an independent published figure. Never mix versions, silently change HS revision, or treat absent flows as zero.

## 5. Analytical schema

- `dim_country(country_code_num, iso3, name, valid_from, valid_to, source)`
- `dim_product(product_code: str, hs_revision, description, level)`
- `dim_basket(basket_id, product_code, hs_revision, rationale)`
- `fact_trade_flow(year, exporter, importer, product_code, hs_revision, value_kusd, quantity_t, source_release, retrieval_date)`, unique on `(source_release, year, exporter, importer, product_code)`
- `mart_importer_product_year(year, importer, basket_id|product_code, total_imports_all_partners, supplier_count, hhi, top1_share, top3_share, effective_suppliers, value_basis)`
- `mart_redirectable_supply(year, importer, supplier, basket_id, supplier_exports_to_importer, supplier_exports_to_rest_of_world)`
- `features_edge_year(...)` and `model_runs(...)` are added in M4.

Raw files are immutable, with SHA-256 checksums in a manifest. Curated data is Parquet; DuckDB is the query engine.

## 6. Metrics

Notation: e = exporter, i = importer, p = product (or basket), t = year.

- **Supplier share:** `share(e,i,p,t) = v(e→i,p,t) / Σ_all e' v(e'→i,p,t)`. The denominator is **all partners**, never a curated subset.
- **Concentration:** `HHI = Σ_e share²`. Also report top-1 and top-3 shares, effective suppliers `1/HHI` and supplier count. Every view shows coverage and the value basis (USD or tonnes).
- **Price check:** compute shares and HHI on value **and** quantity. When they diverge (e.g. 2021–22), flag the result as price-driven.
- **Direct exposure (scenario V1):** `exposed(e,i,p,t,f) = f · v(e→i,p,t)` for an assumed shortfall fraction `f ∈ [0,1]`.
- **Redirectable supply:**
  - `R(e',i,p,t) = Σ_{j≠i} v(e'→j,p,t)` for each alternative supplier e' ≠ e.
  - This is an **observed upper bound** on what could be redirected toward i, before any assumptions about contracts, quality, logistics or politics.
  - Coverage ratio: `Σ_e' R / exposed`.
- **Network:** a directed weighted graph per (year, basket); in/out strength; PageRank. All are reported **alongside the gravity-expected value**, as a ratio or residual. Use NetworkX for clarity, and igraph/rustworkx where performance matters.
- **Export specialization (optional):** RCA, labelled as specialization, not dependency.

## 7. Forecasting benchmark (M4)

- **Target:** `log1p(value)` for t+1 on links already observed (persistent links). Link formation/dissolution is a separate task.
- **Models:**
  - persistence
  - multi-year mean
  - **PPML gravity** (`pyfixest`, CEPII Gravity covariates)
  - LightGBM on lags/growth/shares/HHI
  - LightGBM with graph features computed from data up to the training cutoff only
- **Evaluation:**
  - Expanding-window chronological folds, with the last complete year held out untouched.
  - Metrics: MAE/RMSE in log space, value-weighted USD error, and errors by flow size/basket.
  - If intervals are produced, measure their empirical coverage.
  - Persist predictions for every fold.
- **Honesty:**
  - BACI revises history, so backtests are **retrospective**, not point-in-time.
  - With about 5 folds, report fold dispersion.
  - Real data latency (~1 year) makes "next year" a t+2 problem in practice; state this.
  - Not beating persistence or gravity is a valid result.

## 8. Scenario methodology

- **V1 (M2): direct exposure + redirectable supply.** Inputs: importer, basket, supplier, year, `f`. Outputs:
  - exposed value
  - share of total imports
  - a ranked table of alternative suppliers with `R(e')`
  - coverage ratio

  Purely observed quantities times one explicit assumption.
- **V2 (later level): constrained reallocation.** The user sets capacity assumptions (e.g. redirectable fraction α of `R`). An LP allocation produces a sensitivity band between no reallocation and low/high α. Infeasibility is shown explicitly.
- Never claim real-world substitutability, prices, welfare or GDP effects.

## 9. Architecture (ADR-004)

```text
BACI zip (range-read per year) ─► raw snapshot + SHA-256 manifest
        ─► validation (schema, keys, non-negative, code-as-string)
        ─► curated Parquet ─► DuckDB marts (versioned by source_release)
        ─► exported Parquet marts ─► static site (DuckDB-WASM + Mosaic/Plot)
                                   └► later: FastAPI only for server-side compute
```

**Stack:**
- **Pipeline:** Python 3.12, `uv`, DuckDB, Polars, PyArrow, pytest, Ruff.
- **Validation:** Pandera, or plain DuckDB assertion queries if lighter.
- **Models:** pyfixest, LightGBM, scikit-learn.
- **Site:** a static framework (Observable Framework, Evidence or Vite), chosen by an M1 spike.
- **CI:** GitHub Actions.
- **Deferred until needed:** MLflow, Docker, FastAPI, auth.

## 10. Repository layout (target; create directories only when they get content)

```text
configs/            baskets.yaml, pipeline config
data/               (git-ignored) raw/, curated/, marts/
docs/               source_inventory, data_dictionary, decisions, methodology, evaluation_protocol
src/tradegraph/     ingestion/ validate/ transforms/ metrics/ graphs/ scenarios/ forecasting/
site/               static front end
tests/              fixtures/ (tiny hand-computed data)
reports/            write-ups and figures
```

## 11. Roadmap (single ladder)

Each milestone ends in a **working, tested, demoable state** and is a valid place to stop.

| # | Milestone | Deliverable | Exit gate |
|---|---|---|---|
| **M0** | Data feasibility | `source_inventory.md`, `baskets.yaml`, one BACI year inspected, sample reconciled, coverage figure | G0 checklist complete; source and baskets agreed |
| **M1** | Dependency slice | Reproducible pipeline → marts; static Dependency Profile (supplier shares, HHI trend, value vs tonnes, coverage, table view) | Rebuild from raw is deterministic; metrics pass hand-fixture tests. **Done 2026-11-06** |
| **M2** | Exposure & first finding | Scenario V1 (direct exposure + redirectable supply) in the site; one written finding in `reports/` | Identity tests (`exposed ≤ v`, shares sum to 1); finding has caveats and reproduction steps. **Done 2026-11-06**: `reports/m2_rare_earths/` |
| **M3** | Network view | Per-basket network + ranked table; centrality vs gravity expectation | Network/table parity; gravity null documented. **Done 2026-11-06** (ADR-006) |
| **M4** | Forecast benchmark | Persistence / gravity / GBM / GBM+graph backtests and dashboard | Untouched holdout; leakage tests; honest results write-up. **Done 2026-11-06** (`reports/m4_forecast/`, ADR-007) |
| **M5** | Product polish | Design system, accessibility pass, CI, demo gallery/video, data/model cards | Clean setup from README; a11y checklist passes. **Done 2026-11-06**, except the demo video (gallery of real screenshots instead) |

**Optional levels beyond M5** (each needs its own go/no-go):

| Level | Extension | Go condition |
|---|---|---|
| L1 | Geospatial map/globe, time-lapse of annual snapshots | Map adds insight over profile; performance budget met. **Done 2026-11-06**: trade map, globe, year slider, disruption preview |
| L2 | Constrained reallocation (LP), Monte Carlo sensitivity | V1 used and understood; capacity assumptions defensible. **Done 2026-11-06** (ADR-008) |
| L3 | Fresher/finer data (Comext, US Census monthly), nowcasting | Licence fit; clear user question. **EU done 2026-11-06** (ADR-009); EU nowcast on the BACI basis done 2026-11-11 (ADR-013, ADR-015); US waits for an API key |
| L4 | Input-output indirect exposure (OECD ICIO) | Compatible classifications; validated bridge. **Deferred** (ADR-010) |
| ML | Learned substitution capacity for scenarios (A); EU transport mode, observed (F) | **Done 2026-11-11** (ADR-012, ADR-014). Anomaly alerts (D) and forecast intervals (E) are candidates |
| L5 | Graph ML / temporal GNN vs M4 baselines | Enough data volume; ablation plan |
| L6 | Evidence-grounded AI analyst over the validated marts | Stable marts and an eval harness for numeric fidelity |
| L7 | Research workspaces, saved scenarios, report export | Real users asking for it |
| L8 | Scheduled ingestion, anomaly alerts, cloud hosting | Sustainable data terms and cost |

**Rough pace (part-time):**
- M0: 1 week
- M1: 3–4 weeks
- M2: 1–2 weeks
- M3 and M4: 2–3 weeks each

These are estimates, not deadlines.

## 12. Definition of done (every milestone)

- Tests and lint actually run and pass; commands are listed in the README.
- No secrets, raw licensed bulk data or heavy artifacts in git.
- Every figure shows source release, units, value basis, filters and coverage.
- Metrics are verified against hand-computed fixtures.
- At least one limitation is stated in the milestone notes.
- `docs/decisions.md` is updated for meaningful choices.

## 13. Learning objectives

- **Economics:** trade-data reconciliation, gravity, concentration, limits of risk indicators.
- **Data:** schema design, SQL, missingness, reproducible pipelines, versioned data.
- **ML:** temporal validation, leakage, baselines, error decomposition.
- **Engineering:** static analytics delivery, testing, CI.
- **Communication:** separating observations, forecasts, scenarios and causal claims.

## 14. References

- CEPII BACI: https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37 · FAQ: https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/FAQ_BACI.html
- Gaulier & Zignago (2010), *BACI: International Trade Database at the Product-Level*, CEPII WP 2010-23.
- CEPII Gravity database: https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=8
- Harvard Growth Lab Atlas data: https://atlas.hks.harvard.edu/data-downloads/
- UN Comtrade API & subscriptions: https://uncomtrade.org/docs/un-comtrade-api/ · https://uncomtrade.org/docs/subscriptions/
- WITS product concordances: https://wits.worldbank.org/product_concordance.html
- pyfixest (PPML): https://github.com/py-econometrics/pyfixest
- Mosaic (linked views over DuckDB): https://idl.uw.edu/mosaic/
