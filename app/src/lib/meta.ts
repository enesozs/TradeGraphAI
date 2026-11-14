import { useJson } from "./db";

export type Basket = { id: string; label: string; short_label?: string | null; codes: string[]; caveats?: string[]; value_only?: boolean };
export type BuildInfo = {
  source: { release: string; hs_revision: string; license: string; citation: string };
  years: number[];
  provisional_years: number[];
  baskets: Basket[];
  built_at?: string;
  basket_config_sha256?: string;
  movers?: Record<string, unknown>;
};

export function useBuildInfo() {
  return useJson<BuildInfo>("build_info.json");
}

export function latestFinalYear(info: BuildInfo): number {
  return info.years.filter((y) => !info.provisional_years.includes(y)).at(-1)!;
}
