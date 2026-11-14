# Germany and the US now buy about three-quarters of their rare-earth-and-magnet imports from China, and magnets drove the shift

**TradeGraph AI finding #1 · M2 · data: CEPII BACI HS12 V202601 · observed data, no forecasts or scenarios**

## Summary

From 2012–14 to 2021–23, China's share of the import value of rare-earth compounds, metals and permanent magnets rose in both Germany and the United States:

| Importer | China's share by value, 2012–14 → 2021–23 | Concentration (HHI) | Imports per year |
|---|---|---|---|
| Germany | **57.6% → 76.5%** | 0.35 → 0.59 | $586 m → $843 m |
| United States | **51.5% → 72.5%** | 0.31 → 0.54 | $679 m → $782 m |

Both countries became markedly more concentrated. The suppliers that lost ground were mainly Japan (US imports: 16.8% → 8.2%), France, Switzerland and the Philippines.

**The shift is driven by permanent magnets, not raw rare-earth materials.** Magnets make up most of the basket's value (Germany: $777 m of $843 m a year in 2021–23):

| Sub-group | Germany: China share (value / tonnes) | United States: China share (value / tonnes) |
|---|---|---|
| Permanent magnets (850511) | 61.0% → 80.0% / 68.3% → 79.7% | 57.1% → 76.4% / **87.6% → 73.5%** |
| Rare-earth compounds & metals (280530, 284610, 284690) | **45.5% → 36.2%** / 28.2% → 51.9% | 45.6% → 60.6% / 60.9% → 71.9% |

## What the numbers say, and what they don't

1. **Magnets, by value: a clear rise in both countries.** By value, China went from supplying a majority of German and US magnet imports to supplying about four-fifths.
2. **US magnets by tonnes move the other way.** China's *tonnage* share of US magnet imports fell, from 87.6% to 73.5%, while its *value* share rose. The likely explanation is a change in product mix or price: US imports from China moved toward higher-value magnets per tonne, consistent with a larger share of rare-earth (NdFeB) magnets among the metal magnets in this code. This code can't separate magnet types, so this is a hypothesis, not a result.
3. **Rare-earth materials diverge between the two countries.** For Germany, China's share of materials fell by value but rose by tonnes. For the US it rose on both measures. Germany's materials imports also halved in value ($132 m → $66 m a year) while tonnage rose, consistent with falling rare-earth prices since the early-2010s price spike. **Value shares for small, price-volatile goods should not be read alone.**
4. **Exposure is not the same as risk.** These figures describe where recorded imports came from. They say nothing about stockpiles, domestic production, contracts, or how quickly other suppliers could scale up.

## Caveats

- **Basket breadth.** Code 850511 covers *all* permanent magnets made of metal, not only rare-earth magnets. Non-metal magnets, such as ceramic ferrite magnets, sit in a different code (850519, "other than of metal") and are excluded.
- **Mirror data and hubs.** BACI reconciles exporter and importer reports, but goods routed through intermediaries can still be attributed to the hub country rather than the producer.
- **Nominal US dollars.** Rare-earth prices swung widely over 2011–2023, so value-based shares mix price and volume effects. That's why tonnage shares are reported alongside.
- **Windows.** Three-year averages (2012–14 vs 2021–23) reduce the influence of single odd years. 2024 is excluded because it is provisional in this BACI release.
- **Descriptive only.** No causal claim is made about policy, prices or industrial strategy.

## Reproduce

```bash
uv run tradegraph all                         # BACI 2012–2024 → validated → marts
uv run python reports/m2_rare_earths/build.py # writes figures.json with every number above
```

The split into sub-groups uses `configs/analysis/rare_earths_split.yaml`. Every number in this document is in `reports/m2_rare_earths/figures.json`. The year-by-year history for each pair is on the site's Dependency profile (basket "Rare-earth compounds, metals and permanent magnets").

*Source: CEPII BACI (Gaulier & Zignago, 2010), Etalab Open Licence 2.0. Not affiliated with or endorsed by CEPII.*
