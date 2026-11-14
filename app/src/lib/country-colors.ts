// One fixed, bright colour per country, used for its border glow, its dot and every flow INTO it.
// Stable across baskets and years (assigned once from overall trade size), so a country keeps its colour.
import { useEffect, useState } from "react";
import { query } from "./db";
import { loadGeo } from "./geo";

export type RGB = [number, number, number];

// Ten well-separated, saturated hues for a dark map (red → orange → yellow → lime → green → cyan → blue → violet → magenta → rose).
export const COUNTRY_PALETTE: RGB[] = [
  [255, 77, 109],
  [255, 145, 64],
  [255, 214, 72],
  [168, 230, 82],
  [46, 229, 157],
  [38, 212, 242],
  [77, 125, 255],
  [160, 110, 255],
  [240, 92, 216],
  [255, 170, 190],
];

const rad = Math.PI / 180;
function gcKm(a: [number, number], b: [number, number]): number {
  const s = Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Greedy spatial colouring. Countries are taken biggest first; each takes the palette colour whose nearest
 * already-coloured holder is farthest away (an unused colour wins outright, in palette order).
 * Result: the ten largest traders get ten different colours, and nearby countries rarely share one.
 */
export function assignCountryColors(order: string[], anchor: Map<string, [number, number]>, palette: RGB[] = COUNTRY_PALETTE): Map<string, RGB> {
  const holders: [number, number][][] = palette.map(() => []);
  const out = new Map<string, RGB>();
  for (const iso3 of order) {
    const p = anchor.get(iso3);
    if (!p || out.has(iso3)) continue;
    let best = 0, bestD = -1;
    palette.forEach((_, k) => {
      const d = holders[k].length === 0 ? Infinity : Math.min(...holders[k].map((q) => gcKm(p, q)));
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    });
    holders[best].push(p);
    out.set(iso3, palette[best]);
  }
  return out;
}

let colorsPromise: Promise<Map<string, RGB>> | null = null;
export function useCountryColors(): Map<string, RGB> | null {
  const [c, setC] = useState<Map<string, RGB> | null>(null);
  useEffect(() => {
    colorsPromise ??= (async () => {
      const [geo, rows] = await Promise.all([
        loadGeo(),
        query<{ iso3: string }>("SELECT iso3 FROM network_nodes GROUP BY iso3 ORDER BY sum(exports_kusd + imports_kusd) DESC"),
      ]);
      const ranked = rows.map((r) => r.iso3);
      const rest = [...geo.anchor.keys()].filter((k) => !ranked.includes(k)).sort();
      return assignCountryColors([...ranked, ...rest], geo.anchor);
    })();
    colorsPromise.then(setC);
  }, []);
  return c;
}
