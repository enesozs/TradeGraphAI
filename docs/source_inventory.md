# Source Inventory (M0)

**Status:** in progress · **Last checked:** 2026-11-05.

Every fact below is either:
- quoted or derived from an official page or downloaded file (source given), or
- marked **PENDING**.

## 1. Recommendation

| Role | Source | Status |
|---|---|---|
| Primary bilateral flows | **CEPII BACI, HS12, V202601** | Recommended; the sample check is PENDING |
| Gravity pair covariates | CEPII Gravity V202211 | Usable for variables that don't change over time; ends 2020 |
| GDP / macro (2012–2024) | World Bank WDI API (CC BY 4.0) | Downloaded; reserved for M4/M5 |
| Trade agreements after 2021 | Carried forward from CEPII Gravity (ADR-006) | WTO data not used |
| Validation spot checks | UN Comtrade public preview (M0 only) | **Not used beyond M0**; no Comtrade data is published (project rule, 2026-11-06) |
| Fallback flows | Harvard Growth Lab Atlas | Licence not stated; see §3 |

## 2. CEPII BACI: G0 checklist

| Item | Finding | Evidence |
|---|---|---|
| Licence | **Etalab Open Licence 2.0**: "any use is authorized, provided the source is mentionned." No Comtrade subscription requirement appears on the current pages. An older CEPII page mentions one; the current pages do not. | [BACI page](https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37), [FAQ Q5](https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/FAQ_BACI.html) |
| Citation | Gaulier, G. and Zignago, S. (2010). *BACI: International Trade Database at the Product-Level. The 1994-2007 Version.* CEPII Working Paper N°2010-23 | Readme.txt in the zip |
| Release | V202601. The Readme gives the release date as 2026-01-22; the website says it was updated 2026-01-30. Updated every January. | Readme.txt; FAQ Q1 |
| HS revision chosen | **HS12** (years 2012–2024). HS17 starts in 2017, so it can't cover 2015–16. | Zip member list |
| Granularity | Year × exporter × importer × HS6 product; 5,202 HS12 product codes | `product_codes_HS12_V202601.csv` |
| Columns / units | `t` year, `i` exporter, `j` importer, `k` product, `v` value (**thousand current USD**), `q` quantity (**metric tons**) | Readme.txt |
| Reconciliation | One reconciled flow per pair. CIF costs are estimated and removed from importer reports (FOB basis), and reporters are weighted by reliability. | BACI page, Methodology |
| Zero / missing | "Only the strictly positive trade flows are recorded." An absent row means **not recorded**, not a confirmed zero. | DescriptionBACI |
| Minimum value threshold | Not stated by CEPII. In practice there is none: 2023 values go down to 0.001 k USD ($1). | 2023 sample |
| Quantity coverage | `q` is missing on 3.5% of rows overall (ICs 13.9%, antibiotics 11.4%). Blanks parse as NULL. Tonnes are meaningless for ICs, so the value basis there is USD only. | 2023 sample |
| Sample integrity (2023) | 11,755,559 rows; 226 exporters and 226 importers; 5,199 products. No duplicate `(t,i,j,k)` keys, no `v ≤ 0`, no self-flows, every `k` is 6 characters, and all country codes resolve. World total is $23.0 tn. | `scripts/m0/inspect_2023.py` |
| Country codes | 238 entries. These are **Comtrade-style numeric codes, not pure ISO numeric**: France = 251 (ISO 250), India = 699 (ISO 356), USA = 842 (ISO 840), Switzerland = 757 (ISO 756). **Always join on `country_iso3`.** | `country_codes_V202601.csv` |
| Special codes | `490 "Other Asia, nes"` (ISO3 `S19`) is the proxy for **Taiwan**, which matters for semiconductors. `697 "Europe EFTA, nes"` (`R20`). Historical entities such as `58` Belgium-Luxembourg (until 1998) and `891` Serbia and Montenegro (until 2005) fall outside our window. | Same file |
| Product codes | 6-digit **strings** with leading zeros (e.g. `010121`). Never cast them to integer. | Product code file; DescriptionBACI |
| File sizes | Full HS12 zip: 1,267,950,839 bytes. Each year's CSV is about 81–104 MB compressed and 294–382 MB uncompressed. 2015–2024 together are about **1.0 GB compressed / 3.7 GB CSV**. | HTTP HEAD; zip index |
| Download method | The server supports HTTP range requests (`Accept-Ranges: bytes`, 206 responses). Individual members can be extracted without downloading the whole archive; listing the index cost 1,194 bytes. | Tested 2026-11-05 |
| Provisional year | The last year (2024) "may be substantially revised in the subsequent version." Flag it in the UI. | FAQ Q3 |
| Versioning | "Users should not mix versions of BACI." Every fact row carries `source_release`. | FAQ Q4 |
| Sample reconciliation | **Passed.** For three test flows (China→USA and China→Germany Li-ion, Brazil→Germany coffee in 2023), BACI's reconciled value falls within, or within about 2% of, the range between the importer's and the exporter's own reports. One flow showed a large exporter-vs-importer gap (consistent with transit through EU hubs), which is why a reconciled source matters. Reported weights disagreed more than values. Raw reporter figures are deliberately not reproduced (licence). | Manual M0 check; the query script was removed from the repository (project rule) |

### Raw files retrieved so far

These were stored under `data/raw/baci/HS12_V202601/`, which is git-ignored. Each file was extracted from `BACI_HS12_V202601.zip` by range read on 2026-11-05.

| File | Bytes | SHA-256 |
|---|---|---|
| Readme.txt | 571 | `156c8fe9d8582f24fdec5c43d912e3736dc515a6efd5cd04e513095a0db44c66` |
| country_codes_V202601.csv | 5,346 | `c6892f28bea23d689b29b074d299cea7f5196c708b03026fbe419fa4ecb4e820` |
| product_codes_HS12_V202601.csv | 573,394 | `092789b3f6576c98440e52afcbb7dbc51f646f0db6198d0f6f925cb73d58527e` |

## 3. Other sources

### CEPII Gravity
- **Release:** V202211, Etalab 2.0 licence.
- **Coverage:** "from 1948 to 2020".
- **Content:** GDP and population, distance, language and other cultural proximity measures, colonial ties, and GATT/WTO membership and trade agreements.
- **Formats:** CSV, R (rds) and Stata (dta) zips.
- **Gap:** no coverage for 2021–2024. PENDING: confirm contiguity and common-language variable names in the documentation PDF.
- **Source:** [Gravity page](https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=8).

### Harvard Growth Lab Atlas
- **Classifications:** HS92 from 1995, HS12 from 2012, HS22 from 2022, and SITC Rev. 2.
- **Licence:** **not stated** on the data-downloads page. The page says: "We encourage reuse and adaptation, provided that users cite the Atlas and underlying data sources." Each file has its own citation requirements.
- **Release timing:** 2024 data is released April–June 2026.
- **Role:** fallback only, unless a per-file licence is confirmed.
- **Source:** [data downloads](https://atlas.hks.harvard.edu/data-downloads/).

### UN Comtrade
- **Free individual tier:** 500 API calls/day and up to 100k records per call.
- **Redistribution:** re-disseminating data, even transformed data, requires an active **premium** subscription.
- **Role:** six lookups during M0 for the reconciliation check above; **not used since**. The project is meant to be publicly deployable, so Comtrade data is neither stored nor published, and any future use needs a licence review first.
- **Source:** [Comtrade wiki](https://comtradewiki.azurewebsites.net/?p=78).

## 4. Classification findings that shape scope

- **PV can't be isolated in HS12.** Code `854140` combines PV cells, PV modules **and LEDs**. HS22 splits them, but only from 2022, so PV is excluded from the core baskets (see `configs/baskets.yaml`).
- **Permanent magnets are broader than rare-earth magnets.** `850511` covers all metal permanent magnets, not only NdFeB.
- **Lithium ores have no dedicated HS12 code**, so the lithium basket starts at the chemicals stage.
- **Hub re-exports.** Re-exports through Hong Kong, Singapore and the Netherlands can inflate apparent supplier roles, especially for ICs. This needs a caveat in the UI and possibly a sensitivity view that excludes hubs.

## 5. Requirements this places on the M1 pipeline

- **Ingestion.** Range-read yearly members from the zip, verify each member's CRC, and record its SHA-256 (`scripts/m0/fetch_member.py` is the prototype).
- **Types.** `k` is read as VARCHAR. `q` is read as text and then `TRY_CAST`, because blanks mean NULL.
- **Countries.** Join on `country_iso3`, never on the numeric code. Display 490/`S19` as "Other Asia, nes (incl. Taiwan)".
- **Value basis.** Support both value and tonnes, except for baskets flagged as value-only (ICs).
- **Hubs.** Flag hub re-exporters (HKG, SGP, NLD, BEL) for an optional sensitivity view.
- **Validation.** Encode the 2023 integrity results above as automated checks that run for every year.

## 6. M0 gate: passed (2026-11-06)

1. Baskets approved, and kept as editable configuration (ADR-003).
2. Window: **2012–2024** for BACI and World Bank GDP; 2024 is flagged as provisional.
3. BACI HS12 accepted as the primary source (ADR-002), after the comparison of alternatives and the licence check.

M0 artifacts:
- this file
- `configs/baskets.yaml`
- `reports/m0/coverage_2023.html` (exploratory coverage figure)
- `scripts/m0/` (exploratory scripts, superseded by M1)

## 7. Sources added after M0 (2026-11-06)

| Source | Use | Licence / terms | Status |
|---|---|---|---|
| Eurostat Comext DS-045409 | L3 monthly EU imports (HS6), Jan 2023 – latest | Eurostat reuse policy: reuse with acknowledgement; adaptations flagged | **In use** |
| US Census Bureau international trade API | L3 monthly US imports (HS6) | Free API key required for every call; must show "This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau." | Adapter ready, **dormant** (no key) |
| OECD TiVA 2025 (FDVA) | L4 indirect exposure | CC BY 4.0 since July 2024 (attribution) | **Deferred**: API error; bulk file 1.5 GB |
| Natural Earth via world-atlas | Map geometry | Public domain (data); ISC (package) | In use |
