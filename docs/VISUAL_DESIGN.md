# TradeGraph AI — Visual Design

**Status:** visual specification; no UI exists yet.

## Art direction

The look is an elegant *civilian economic observatory*: analytical, trustworthy and quietly striking. It should not look like a sci-fi command centre.

- **Surfaces:** dark graphite/navy first, with a full light theme.
- **Accents:**
  - restrained teal/cyan for observed data
  - warm amber for scenario assumptions
  - violet for forecasts
  - muted coral for data-quality warnings
- **Typography:** clean sans-serif, tabular numerals for metrics, generous whitespace.
- **Avoid:** military motifs, threat reticles, alarmist red, fake live feeds.

**Principles:**
- Beautiful **and** legible.
- Dense without chaos.
- Motion only when it carries meaning.
- Every impressive visual leads to its exact numbers and methodology.

## Observatory canvas (owner direction, 2026-11-06)

The Network and Map pages use an always-dark "observatory" canvas (`site/src/components/observatory.js`):
- faint grid, glowing links, and nodes coloured by **trade community** (Louvain clusters, tagged "<largest member> cluster")
- the Map shows the network on the globe: curved arcs from exporter to importer, coloured by community

These references were taken: a dense clustered network with tagged clusters; a dark cartographic base for disruption views.

**Deliberately not taken** from a "geopolitical risk" military-style reference:
- threat levels, reticles, alarm-red overlays, conflict framing
- **chokepoints or shipping lanes**: BACI has no route data, so they would be invented

Disruption views use amber with an explicit SCENARIO label. A real route layer would need a separate maritime source; IMF PortWatch is a candidate, pending a licence check and owner approval.

## Screen priority

Screens are built in roadmap order. The first one is the product's core.

### 1. Dependency Profile (M1, hero screen)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TRADEGRAPH   [Importer ▾] [Basket ▾] [Year ◀ 2023 ▶]  [Value | Tonnes]   │
│ BACI HS12 V202601 · k USD · all partners · coverage ●                   │
├────────────────────────────────┬─────────────────────────────────────────┤
│ SUPPLIER SHARES (ranked bars)  │ CONCENTRATION OVER TIME                 │
│ top-N + "all others" bar       │ HHI line · top-1 share · effective N    │
│ exact % and value on hover     │ value vs tonnes overlay; price flag     │
├────────────────────────────────┼─────────────────────────────────────────┤
│ KPI strip: total imports ·     │ SUPPLIER MIX OVER TIME                  │
│ suppliers · HHI · top-1 share  │ stacked area / small multiples          │
├────────────────────────────────┴─────────────────────────────────────────┤
│ Data table (exportable CSV) · Methodology drawer · Caveats              │
└──────────────────────────────────────────────────────────────────────────┘
```

**User question:** "How concentrated is X's supply of P, and is that changing?"

**Acceptance:**
- Shares sum to 100% including "all others".
- Every number matches the mart.
- The value/tonnes toggle changes every chart consistently.
- The provisional last year is visibly marked.

### 2. Exposure panel (M2)

This panel is added beside the Dependency Profile:
- **Controls:** pick a supplier and set the shortfall slider `f`.
- **Exposed value:** shown as a bar against total imports.
- **Alternatives:** a ranked table of alternative suppliers with **redirectable supply**, meaning their exports of P to the rest of the world.
- **Coverage ratio:** shown as a gauge.

Assumptions appear as amber chips. A ledger lists every assumption in plain language.

**Acceptance:**
- `exposed ≤ observed value` always holds.
- `f = 0` yields no exposure.
- Labels say **Scenario**, never forecast.

### 3. Network view (M3)

A force-directed or circular layout per basket and year:
- top-N edges by default, with an adjustable threshold
- arrows for direction
- node size = trade strength
- a toggle to color by **observed / gravity-expected** ratio

Selecting a node shows its ego network while keeping the global context. A ranked table sits beside the graph with the same numbers. Communities are labeled as algorithmic groupings, not political blocs.

### 4. Forecast lab (M4)

Three linked panels:
- a chronological fold/holdout ribbon
- observed vs persistence vs gravity vs ML, with intervals
- error breakdown by flow size and basket

Each view has a run selector and a data/code version hash. SHAP plots are labeled "predictive association". Failures are visible, not hidden.

### 5. Later levels (L1+)

- Map or globe with statistical arcs: an optional overview with a 2D fallback, never the default entry point.
- Scenario studio with LP reallocation and sensitivity bands.
- AI analyst desk *beside* inspectable data, showing every tool call and source.

## Motion

- Time scrubbing steps through **observed annual snapshots**. Interpolated frames are labeled as such.
- Scenario changes: affected bars and edges dim and quantities animate, with labels kept explicit.
- Every animation has a reduced-motion alternative. Never animate vessels or imply live tracking.

## Reusable components

- global importer/basket/year filter
- provenance chip (source, release, units)
- coverage badge
- value-basis toggle
- KPI tile
- data-quality banner
- assumption chip and ledger
- explanation drawer
- table/CSV export
- empty, loading and error states

## Visualization integrity checklist (every view)

1. Title, units, year, product definition, HS revision and source release are visible.
2. Scale, direction, weights and denominator are defined.
3. Observed, forecast, scenario and synthetic results look visibly different.
4. Coverage, revisions and uncertainty accompany any interpretation.
5. Bilateral aggregates never suggest physical shipping paths.
6. Tooltips show exact values; an equivalent data table exists.
7. Keyboard navigation, reduced motion, encodings that aren't color-only, and sufficient contrast.
8. Tested with empty sets, dense graphs, narrow screens and extreme values.

## Assets and screenshots

- Concept mock-ups go in `assets/concepts/`, labeled **CONCEPT**, with any numbers labeled **SYNTHETIC**.
- Screenshots of the running app go in `docs/screenshots/`. Only real screenshots count as proof of features.
- Each milestone includes one visual review: a screenshot, a numeric accuracy audit and annotated improvements.
