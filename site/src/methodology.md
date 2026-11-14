---
title: Methodology
---

# Methodology

```js
const info = FileAttachment("data/build_info.json").json();
```

## Data

**Source:** CEPII BACI, revision ${info.source.hs_revision}, release V${info.source.release}, covering years ${info.years[0]}–${info.years.at(-1)}. The latest year (${info.provisional_years.join(", ")}) is provisional and may be revised.

BACI reconciles the two reports of each trade flow, the exporter's and the importer's, into a single figure:
- It estimates shipping and insurance costs and removes them from import values.
- It weights each reporting country by how reliable its reports are.

Values are in thousands of current US dollars and quantities in metric tonnes. Only strictly positive flows are recorded, so **a missing flow means "not recorded", not "zero"**.

*${info.source.citation}* Licence: ${info.source.license}. This site is not affiliated with or endorsed by CEPII.

## Product baskets

A basket is a set of 6-digit HS12 product codes, defined in `configs/baskets.yaml`.

```js
display(Inputs.table(info.baskets.map((b) => ({Basket: b.label, Codes: b.codes.join(", "), "Value only": b.value_only ? "yes" : "", Rationale: b.rationale})), {rows: 10}));
```

## Metrics

For importer *i*, basket *p*, year *t*, with supplier *e*'s exports to *i* written *v(e→i)*:

- **Supplier share:** v(e→i) ÷ Σ v(e'→i), summed over **all** suppliers e'.
- **HHI:** the sum of squared shares. It runs from near 0 (many small suppliers) to 1 (a single supplier). **Effective suppliers** = 1 ÷ HHI.
- **Tonnes basis:** the same formulas using quantities, computed only over flows that have a recorded quantity. Coverage is reported alongside, and it's switched off for baskets where tonnes aren't meaningful (chips).
- **Redirectable supply:** supplier e's basket exports to every country other than *i*. It's an observed upper bound on what e could send *i* instead, ignoring contracts, product mix, logistics and policy. It is **not** a forecast.

## Network and gravity baseline

- **Network:** one directed graph per basket and year. Arrows run from exporter to importer, weighted by recorded value.
- **Supplier centrality:** PageRank on the reversed graph, so importers pass importance to their suppliers in proportion to import shares. It describes position in the network; it doesn't measure indispensability.
- **Gravity model:** a PPML regression of each pair's trade on distance, shared border, common official language, colonial tie and trade agreement in force, with exporter-year and importer-year effects. Inputs come from CEPII Gravity V202211; agreements after 2021 carry the 2021 status forward. **Inside this model only**, pairs with no recorded trade count as zero, which PPML requires.
- **Relative to gravity:** centrality on the observed network divided by centrality on the gravity-expected network. Gravity reproduces each country's total trade exactly, so this ratio isolates *who trades with whom*.
- **Robustness:** dropping the smallest 10% of economies leaves the results essentially unchanged.

## What this does not show

- Aggregate trade flows are not firm-level supply chains or shipping routes.
- Concentration measures exposure; it doesn't measure risk or likelihood of disruption.
- Values are nominal, so price swings move them. Compare the value and tonnes views.
- Hub re-exports can overstate a hub's role and hide the country of origin.

*Build: ${info.built_at} · basket config SHA-256 ${info.basket_config_sha256.slice(0, 12)}…*
