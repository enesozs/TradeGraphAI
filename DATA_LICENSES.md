# Data licences and attributions

The [MIT License](LICENSE) covers the source code only. The data in this repository is **derived from third-party sources and stays under their own terms**:
- the published app data in `app/public/data`
- the figures in `reports/`
- the screenshots in `docs/screenshots`

Raw source files are never committed. They are downloaded by the pipeline and kept out of git.

TradeGraph AI is a non-commercial project. It is not affiliated with or endorsed by any of the organisations below. The data is reused as published and then adapted (aggregated, converted and modelled), as described for each source. The organisations are not responsible for the adapted figures.

Terms were checked against each source's published terms on 2026-11-14.

## CEPII BACI and CEPII Gravity

- **Licence:** [Etalab Open Licence 2.0](https://github.com/etalab/licence-ouverte/blob/master/open-licence.md). It allows reuse, adaptation and redistribution, including commercial use, with an acknowledgement of the source and its date of last update. It is compatible with CC BY.
- **BACI:** CEPII, BACI HS12, version 202601, last updated 30 January 2026. <https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37>
  - Cite: Gaulier, G. and Zignago, S. (2010). *BACI: International Trade Database at the Product-Level. The 1994–2007 Version.* CEPII Working Paper N°2010-23.
- **Gravity:** CEPII, Gravity database, version 202211. <https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=8>
  - Cite: Conte, M., Cotterlaz, P. and Mayer, T. (2022). *The CEPII Gravity database.* CEPII Working Paper N°2022-05.
- **Adapted:**
  - Bilateral flows are summed over product baskets.
  - Shares, HHI, changes over time and network measures are computed from them.
  - A gravity model is fitted to the flows and covariates.
  - Forecasts and scenarios are model outputs, labelled as such.

## Eurostat (Comext DS-045409; Comext trade by mode of transport; ert_bil_eur_m)

- **Licence:** [Eurostat copyright notice](https://ec.europa.eu/eurostat/web/main/help/copyright-notice). Statistical data may be reused, commercially or not, provided the source is acknowledged. Modified data must be stated as such, with a disclaimer of Eurostat's non-responsibility.
  - Some data cannot be reused commercially, though non-commercial reuse is unrestricted. This covers data for countries outside the EU and EFTA, and some Swiss, Liechtenstein and Austrian declarations.
  - This project is non-commercial.
- **Source:** Eurostat, © European Union.
  - Comext DS-045409 (EU trade since 1988 by HS2–HS6, monthly)
  - Comext bulk TRANSPORT_HS (extra-EU trade by mode of transport, HS6)
  - ert_bil_eur_m (euro exchange rates, monthly; data disseminated by the European Central Bank: "Source: ECB statistics")
- **Adapted:**
  - Values are summed over product baskets.
  - Shares, 12-month totals and concentration are computed from them.
  - Transport modes are grouped.
  - Monthly EUR values are converted to USD with the monthly rates, and a nowcast model estimates BACI-basis values.
  - The latest month is left out while Eurostat has only partly published it.
  - **Eurostat is not responsible for these adapted figures.**

## IMF PortWatch

- **Terms:** [IMF Copyright and Usage](https://www.imf.org/en/about/copyright-and-terms), linked as the licence of the PortWatch datasets. Data may be reused, adapted and published with attribution to the IMF, and any material transformation must be stated. Commercial reuse requires the IMF's permission.
- **Source:** International Monetary Fund, PortWatch, <https://portwatch.imf.org/>: Daily Chokepoint Transit Calls; Ports and Chokepoints databases. PortWatch credits its sources as "UN Global Platform; IMF PortWatch".
- **Adapted:**
  - Daily transit counts are aggregated to weekly averages.
  - Port shares are used only to choose each country's main gateway ports in the modelled sea-route network.
  - The raw PortWatch tables are not redistributed.
- **Downstream use:** anyone reusing these derived figures must also follow the IMF terms above.

## Sea-route network: Eurostat MARNET via searoute

- **Software:**
  - [searoute](https://github.com/genthalili/searoute-py) (Apache-2.0) computes the modelled routes over Eurostat's MARNET maritime network, from [eurostat/searoute](https://github.com/eurostat/searoute) under EUPL-1.2.
  - The network itself is not redistributed here.
- **Derived geometry:** the lane geometry in `app/public/data/sea_lanes.json` and the route tables built from it (`sea_routes`, `sea_route_closures`, `sea_lane_load`) are derived from MARNET. To be safe, they are distributed under the **EUPL-1.2**, not MIT; see [LICENSES/EUPL-1.2.txt](LICENSES/EUPL-1.2.txt).
- **Not for navigation:** the routes are modelled, not ship tracks.

## Country boundaries: Natural Earth via world-atlas

- `app/public/data/countries-110m.json` is the TopoJSON from [world-atlas](https://github.com/topojson/world-atlas) 2.0.2 (ISC licence, © 2013–2019 Michael Bostock; see [LICENSES/world-atlas-ISC.txt](LICENSES/world-atlas-ISC.txt)).
- It is derived from [Natural Earth](https://www.naturalearthdata.com/) Admin 0 1:110m, which is in the public domain. Made with Natural Earth.

## Not used or not published

- **UN Comtrade:** no Comtrade data is stored or published. BACI is built by CEPII from UN Comtrade reports and is redistributed under CEPII's licence above.
- **World Bank WDI:** GDP is downloaded for the pipeline (CC BY 4.0) but no WDI figures are published.
