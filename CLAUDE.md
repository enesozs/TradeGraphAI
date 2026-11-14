# CLAUDE.md — TradeGraph AI

@AGENTS.md

## Session start

- Find the **current milestone** in the status line at the bottom of this file and in BLUEPRINT §11.
- Read `docs/decisions.md`.
- Read `BLUEPRINT.md` and `docs/VISUAL_DESIGN.md` only for the sections the task touches.
- Say whether the task is core (the current milestone) or a later level. Don't work ahead without agreement.

## Working style

- Act as a product-minded ML engineer, data-visualization designer and trade-economics collaborator.
- For complex choices, give 2–3 options with tradeoffs and recommend one.
- Prefer a tested vertical slice over empty scaffolding. Create directories only when they get real content.
- For a new screen, sketch a component map first. Then build it on deterministic fixture data and verify the numbers.

## Commands

If `VIRTUAL_ENV` points to another Python environment, run `unset VIRTUAL_ENV` first.

```bash
uv run pytest && uv run ruff check . && uv run ruff format --check .
uv run tradegraph fetch|curate|marts|wdi|gravity|forecast|all [--years 2012-2024]   # gravity takes ~30 s
make dev                   # app at http://localhost:5173 (or: cd app && npm run dev); make build, make lint
# site/ is the legacy Observable site, kept for reference only
```

Baskets are config only (`configs/baskets.yaml`). After editing them, run `uv run tradegraph marts`.

## Owner rules

- **Commit after every milestone** (M0, M1, M2, …). Commit at the end of the milestone with a message starting `M<n>:`. Committing mid-milestone is fine too. Never push or deploy without explicit approval.
- **No deployment** until the owner says so.
- **Ask before manually reading or querying large data**, such as the raw BACI CSVs or curated flows. Analysis goes through the pipeline and the site.
- **UN Comtrade: don't use it.** Notify the owner and get approval first; prefer alternatives. Never publish Comtrade-derived numbers (the project is meant to be publicly deployed).
- **Keep the raw BACI snapshot** in `data/raw/`; the release may disappear from CEPII's site.

## Handoff format

Report these items:
- milestone
- files changed
- user-visible result
- tests actually run, with their results
- visual verification status
- scientific caveats
- the single smallest next step
- whether the project is at a coherent stopping point

---

**Current (2026-11-14): Phase 1 React rebuild complete; Phase 2 sea routes built (ADR-011). M0–M5, L1, L2 and L3 (EU) are done; L4 is deferred (ADR-010). Machine-learning additions A (learned substitution capacity, ADR-012), B (EU nowcast, ADR-013) and F (EU transport mode, ADR-014) are done; C was dropped, D and E await the owner. ADR-015 covers Comext months Eurostat has only partly published. Deployment awaits the owner's go-ahead.** M0 passed: BACI HS12 was accepted, the baskets approved, and the window set to 2012–2024. Do the analysis through the pipeline and product, not through ad-hoc manual data exploration.
