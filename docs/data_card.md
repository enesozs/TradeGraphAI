# Data card: TradeGraph AI marts

**Built by:** `uv run tradegraph all` · **Source release:** CEPII BACI HS12 V202601 (+ CEPII Gravity V202211, World Bank WDI)

## Sources and licences

| Source | Used for | Licence | Attribution |
|---|---|---|---|
| CEPII BACI HS12 V202601 | All trade flows, 2012–2024 | Etalab Open Licence 2.0 | Gaulier & Zignago (2010), CEPII WP 2010-23 |
| CEPII Gravity V202211 | Distance, border, language, colonial tie, trade agreements | Etalab Open Licence 2.0 | CEPII Gravity database |
| World Bank WDI (NY.GDP.MKTP.CD) | Downloaded; not used in published outputs yet | CC BY 4.0 | World Bank, World Development Indicators |

No UN Comtrade data is stored or published (see `docs/source_inventory.md`).

## What a row means

- **Trade value:** reconciled bilateral merchandise trade, exporter → importer, HS 6-digit product, calendar year, **thousand current USD, FOB-equivalent**. Quantities are in metric tonnes, and some are missing.
- **Baskets:** sums of HS6 codes defined in `configs/baskets.yaml`.
- **Missing vs zero:** BACI records only strictly positive flows. An absent row means "not recorded", **not** zero. The one exception is inside the gravity model (ADR-006).

## Marts (`data/marts/HS12_V202601/`)

| File | Grain | Notes |
|---|---|---|
| `importer_basket_year.parquet` | basket × importer × year | Imports, supplier count, HHI (value and tonnes), top-1/top-3 share, tonnes coverage, provisional flag |
| `supplier_basket_year.parquet` | basket × importer × supplier × year | Value, tonnes, shares, rank, redirectable supply |
| `movers_importer.parquet` / `movers_supplier.parquet` | basket × importer (× supplier) | 2012–14 vs 2021–23 averages; ≥ $100 m/yr in both windows |
| `network_nodes.parquet` / `network_edges.parquet` | basket × year × country / link | Supplier centrality, observed and gravity-expected; top-250 links |
| `gravity_supplier.parquet`, `gravity_fit.json` | basket × year × pair | Gravity-expected flows and shares; coefficients and robustness |
| `forecast_metrics.json`, `forecast_predictions.parquet` | fold × model | Benchmark results; predictions for links ≥ $10 m |
| `build_info.json` | n/a | Source, units, years, basket config hash, notes |

## Validation (every year, every build)

- No duplicate year × exporter × importer × product keys.
- Values strictly positive; quantities non-negative.
- Product codes are 6-digit strings; every code is in the BACI product list.
- No self-flows; every country code resolves to the country list.
- Raw files are verified by CRC on download and recorded with SHA-256 in `data/raw/*/manifest.json`. Marts rebuild byte-identically from the same inputs.

## Known limitations

- **Taiwan** appears only as "Other Asia, nes" (BACI code 490 / S19).
- **Hubs:** re-exports through Hong Kong, Singapore, the Netherlands and Belgium can make a hub look like a large supplier.
- **Prices:** values are nominal USD, so price swings (notably 2021–22) look like volume changes. Compare the tonnes view.
- **Provisional data:** 2024 is provisional in this release and may be revised.
- **Classification:** HS12 can't separate PV cells or modules from LEDs (code 854140), so solar is not a basket. Code 850511 covers all metal magnets, not only rare-earth magnets.
- **Not supply chains:** aggregate flows are not firm-level supply chains or shipping routes.
