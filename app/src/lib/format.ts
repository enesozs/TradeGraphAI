// Formatting shared by every view. Values from BACI marts are in thousand USD (k USD).

export function usd(kusd: number | null | undefined): string {
  if (kusd == null || Number.isNaN(kusd)) return "–";
  if (Math.abs(kusd) < 0.5) return "$0"; // also avoids "-0" from floating-point noise
  const v = kusd * 1e3;
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)} tn`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 1 : 2)} bn`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} m`;
  return `$${(v / 1e3).toFixed(0)} k`;
}

export function eur(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  if (v >= 1e9) return `€${(v / 1e9).toFixed(2)} bn`;
  if (v >= 1e6) return `€${(v / 1e6).toFixed(1)} m`;
  return `€${(v / 1e3).toFixed(0)} k`;
}

export function tonnes(t: number | null | undefined): string {
  if (t == null || Number.isNaN(t)) return "–";
  if (t >= 1e6) return `${(t / 1e6).toFixed(t >= 1e7 ? 1 : 2)} Mt`;
  if (t >= 1e3) return `${(t / 1e3).toFixed(t >= 1e4 ? 0 : 1)} kt`;
  return `${t.toFixed(0)} t`;
}

export function km(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return "–";
  return `${Math.round(x).toLocaleString("en-US")} km`;
}

export function pct(x: number | null | undefined, digits = 1): string {
  if (x == null || Number.isNaN(x)) return "–";
  return `${(100 * x).toFixed(digits)}%`;
}

// BACI records Taiwan as "Other Asia, nes" (S19).
const NAME_OVERRIDE: Record<string, string> = { S19: "Taiwan (Other Asia, nes)" };
export function countryName(iso3: string | null | undefined, name?: string | null): string {
  if (!iso3) return "–";
  return NAME_OVERRIDE[iso3] ?? name ?? iso3;
}

// Maritime signal-flag palette for trade communities (ordered by community size).
export const SIGNAL = ["#e4572e", "#3a86ff", "#f3c14b", "#2ec4b6", "#9b5de5", "#ff9f1c", "#8ac926", "#f15bb5", "#4cc9f0", "#c9a66b"];
export function communityColor(c: number | null | undefined): string {
  return c == null || c < 0 ? "#5d7286" : SIGNAL[c % SIGNAL.length];
}
export function hexToRgb(hex: string, alpha = 255): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

// Refined flow palette (desaturated, cohesive on the dark chart) for communities on maps and networks.
export const FLOW = ["#62c7e6", "#f2a96b", "#a996f5", "#79d9b0", "#ef8f9a", "#e6cf72", "#86a8ff", "#9fd4c8", "#d8b48a", "#c3a9e8"];
export function flowColor(c: number | null | undefined): string {
  return c == null || c < 0 ? "#7c8fa1" : FLOW[c % FLOW.length];
}
