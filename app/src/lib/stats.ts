import { query } from "./db";

// A country's role in one basket-year: as importer (concentration, top suppliers) and as supplier (who depends on it).
export async function countryStats(iso3: string, basket: string, year: number) {
  const [imp, suppliers, dependents] = await Promise.all([
    query<{ imports_kusd: number; hhi_value: number; supplier_count: number }>(
      `SELECT imports_kusd, hhi_value, supplier_count FROM importer_basket_year WHERE basket_id = ? AND year = ? AND importer_iso3 = ?`, [basket, year, iso3]),
    query<{ iso3: string; share: number; v: number }>(
      `SELECT supplier_iso3 AS iso3, share_value AS share, value_kusd AS v FROM supplier_basket_year WHERE basket_id = ? AND year = ? AND importer_iso3 = ? ORDER BY value_kusd DESC LIMIT 5`, [basket, year, iso3]),
    query<{ iso3: string; share: number; v: number }>(
      `SELECT s.importer_iso3 AS iso3, s.share_value AS share, s.value_kusd AS v FROM supplier_basket_year s
       JOIN importer_basket_year i ON i.basket_id = s.basket_id AND i.year = s.year AND i.importer_iso3 = s.importer_iso3
       WHERE s.basket_id = ? AND s.year = ? AND s.supplier_iso3 = ? AND i.imports_kusd > 50000 ORDER BY s.share_value DESC LIMIT 5`, [basket, year, iso3]),
  ]);
  return { imp: imp[0] ?? null, suppliers, dependents };
}

