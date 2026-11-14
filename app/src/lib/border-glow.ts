// Inner border glow per country, painted once into a Web Mercator texture and shown with a deck.gl BitmapLayer.
// Each country is clipped to its own outline and stroked many times with growing width, so light accumulates
// at the border and fades towards the interior (no bleed into neighbours or the sea).
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { RGB } from "./country-colors";

export const GLOW_BOUNDS: [number, number, number, number] = [-180, -58, 180, 84];
const W = 4096;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const TOP = mercY(GLOW_BOUNDS[3]);
const H = Math.round(((TOP - mercY(GLOW_BOUNDS[1])) / (2 * Math.PI)) * W);

export type GlowSpec = { color: RGB; strength: number }; // strength 0..1 (trade size)

export function paintBorderGlow(countries: FeatureCollection<Polygon | MultiPolygon, { iso3?: string }>, spec: Map<string, GlowSpec>): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.lineJoin = "round";
  const px = (lon: number) => ((lon + 180) / 360) * W;
  const py = (lat: number) => ((TOP - mercY(Math.max(-85, Math.min(85, lat)))) / (2 * Math.PI)) * W;
  const PASSES = 14;
  for (const f of countries.features) {
    const s = f.properties?.iso3 ? spec.get(f.properties.iso3) : undefined;
    if (!s) continue;
    const path = new Path2D();
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys)
      for (const ring of poly) {
        // Unwrap longitudes so a ring crossing the antimeridian continues off-canvas instead of jumping across
        // the whole map; then draw a shifted copy for the part that fell off the edge.
        let prev = ring[0][0], off = 0;
        const pts = ring.map(([lon, lat]) => {
          if (lon - prev > 180) off -= 360;
          else if (prev - lon > 180) off += 360;
          prev = lon;
          return [px(lon + off), py(lat)] as const;
        });
        const xs = pts.map((p) => p[0]);
        const shifts = [0, ...(Math.min(...xs) < 0 ? [W] : []), ...(Math.max(...xs) > W ? [-W] : [])];
        for (const dx of shifts) {
          pts.forEach(([x, y], k) => (k ? path.lineTo(x + dx, y) : path.moveTo(x + dx, y)));
          path.closePath();
        }
      }
    const depth = 12 + 22 * s.strength; // texture px (~1/3 of that on screen at world zoom)
    const [r, g, b] = s.color;
    ctx.save();
    ctx.clip(path, "evenodd");
    // Faint tint over the whole country, then the accumulating border light.
    ctx.fillStyle = `rgba(${r},${g},${b},${0.015 + 0.03 * s.strength})`;
    ctx.fill(path, "evenodd");
    ctx.strokeStyle = `rgba(${r},${g},${b},${0.03 + 0.07 * s.strength})`;
    for (let i = 1; i <= PASSES; i++) {
      ctx.lineWidth = (2 * depth * i) / PASSES;
      ctx.stroke(path);
    }
    ctx.restore();
  }
  return canvas;
}
