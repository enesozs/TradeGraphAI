# AGENTS.md — Shared Contract for Coding Agents

This file is the **single source** for TradeGraph AI's integrity rules and engineering standards. The other documents are:
- Mission, methods and roadmap: [`BLUEPRINT.md`](BLUEPRINT.md)
- Visual spec: [`docs/VISUAL_DESIGN.md`](docs/VISUAL_DESIGN.md)
- Decisions: [`docs/decisions.md`](docs/decisions.md)

## Priorities (in order)

1. Scientific integrity: correct data, provenance and explicit uncertainty.
2. A correct analytical core before any visual or model claims.
3. Strong visual communication from the first milestone. Visuals are functionality.
4. Reproducibility, tests and maintainable code.
5. Ambition in the roadmap, **no speculative bloat in the current task**.

## Scientific contract

- **Edges.** A directed edge means exporter → importer, weighted by reconciled merchandise trade value (BACI: thousands of current USD) or by quantity (tonnes). An edge is **not** a shipping route or a firm-level supply chain.
- **Missing ≠ zero.** BACI records only strictly positive flows. An absent row means "not recorded", not a confirmed zero.
- **Codes and versions.** Product codes are **strings**. Preserve the HS revision and source release. Never mix BACI versions or silently merge HS revisions.
- **Denominators.** Use **all partners** for shares and HHI, never a curated country subset. Show the denominator, coverage and value basis next to every concentration or ranking figure.
- **Prices.** Nominal USD moves with prices. Where value-based and quantity-based results diverge, show both or flag the gap.
- **Kinds of result.** Keep these five kinds separate in schemas, logic and UI: **Observed**, **Forecast**, **Scenario** (assumption-driven), **Causal estimate** (only with an identification strategy), **Synthetic** (illustrative).
- **Network scores.** Centrality and model attributions are descriptive. They do not prove indispensability or causation. Compare centrality against a gravity-expected baseline before interpreting it.
- **Scenarios.** Scenarios are exposure arithmetic under stated assumptions. They never claim welfare, GDP, price or real-world substitution effects.
- **Forecasts.** Use chronological splits only, with features built from data up to the training cutoff. Label backtests on revised data as retrospective. Not beating a baseline is a valid, reportable result.
- **Language.** Use neutral, civilian-economic language: no militarized branding and no implied geopolitical foreknowledge. Never fabricate live data, records, benchmark results or screenshots.

## Workflow

1. Before coding, read the current milestone (BLUEPRINT §11), `docs/decisions.md`, and the existing code and tests.
2. Propose a narrow plan covering five things:
   - the user outcome
   - the visible artifact
   - the analytical contract (data, formulas, units, guardrails)
   - the files to change
   - verification
3. Build one vertical slice. Check the numbers against tiny hand-computed fixtures **before** polishing the UI.
4. Run tests and lint. Never report an unrun check as passed. For UI changes, capture real screenshots or say that you couldn't.
5. Record meaningful choices in `docs/decisions.md`.
6. Finish with: changed files, commands run and their results, screenshot status, limitations, and one proposed next step.

## Engineering standards

- **Tooling.** Python 3.12+, `uv` with a lockfile, typed public functions, small modules, Ruff, pytest.
- **Data.** DuckDB, Polars and Parquet. Raw files are immutable, with SHA-256 checksums in a manifest.
- **Tests.** Metric arithmetic on hand fixtures, validation of uniqueness and non-negative values, leakage tests for forecasting, and boundary/infeasibility tests for scenarios.
- **Git hygiene.** Keep raw licensed bulk data, `.env`, secrets and heavy artifacts out of git. Log source URL, release, checksum, retrieval date and licence for every dataset.
- **Ask first.** Get approval before large downloads (>100 MB), paid APIs, cloud deployments, destructive operations or irreversible schema changes.
- **Tool choices.** The tools named in the docs are **candidates**. Propose better tools or data sources when there's evidence for them, and record why in `docs/decisions.md`.

## Visual standards (details in docs/VISUAL_DESIGN.md)

- Every view needs title, units, year, product definition, source release and coverage.
- Every map or network view has an equivalent table.
- Encodings are accessible: colorblind-safe, never color-only, keyboard-navigable, reduced-motion support.
- Label mock-ups **CONCEPT** and made-up numbers **SYNTHETIC**, prominently.
- Prefer a reduced but correct visualization over a spectacular, misleading one.

## Stop rule

The owner decides when the project is "enough". Every milestone must leave the project in a publishable state. Planned features are described as **planned**, never as implemented.
