// Shared cartographic base for the deck.gl maps (Trade map, Sea routes): charcoal sea, graphite land,
// a faint survey grid with dots at the crossings, and additive blending for light-like marks.
export type RGBA = [number, number, number, number];

export const SEA = "#0e1519";
export const LAND: RGBA = [27, 35, 41, 255];
export const BORDER: RGBA = [255, 255, 255, 18];
export const GRID: RGBA = [160, 190, 200, 20];
export const GRID_DOT: RGBA = [170, 200, 210, 70];
export const VIGNETTE = "radial-gradient(ellipse at 55% 45%, transparent 55%, rgba(4,8,10,0.55) 100%)";

// Additive blending: overlapping marks build up light instead of paint.
export const ADDITIVE = {
  depthWriteEnabled: false,
  depthCompare: "always",
  blend: true,
  blendColorOperation: "add",
  blendColorSrcFactor: "src-alpha",
  blendColorDstFactor: "one",
  blendAlphaOperation: "add",
  blendAlphaSrcFactor: "one",
  blendAlphaDstFactor: "one-minus-src-alpha",
} as const;

// Survey grid every 30° with a dot at each crossing (±60°: the maps show no polar seas).
const GRID_LONS = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
const GRID_LATS = [-60, -30, 0, 30, 60];
export const GRID_LINES: [number, number][][] = [
  ...GRID_LONS.map((lon) => Array.from({ length: 13 }, (_, k) => [lon, -60 + k * 12] as [number, number])),
  ...GRID_LATS.map((lat) => Array.from({ length: 25 }, (_, k) => [-180 + k * 15, lat] as [number, number])),
];
export const GRID_DOTS: [number, number][] = GRID_LONS.flatMap((lon) => GRID_LATS.map((lat) => [lon, lat] as [number, number]));

// Chip label style shared by both maps (TextLayer props).
export const CHIP = {
  background: true,
  getBackgroundColor: [12, 18, 22, 215] as RGBA,
  getBorderWidth: 1,
  backgroundPadding: [5, 2, 5, 2] as [number, number, number, number],
  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  fontWeight: 500,
  characterSet: "auto" as const,
  getSize: 11,
};

// Greedy screen-space placement of chip labels: right of the mark, else left, else skipped.
export type Box = [number, number, number, number];
export function placeChip(boxes: Box[], x: number, y: number, r: number, text: string): "start" | "end" | null {
  const w = text.length * 6.1 + 12;
  for (const side of ["start", "end"] as const) {
    const box: Box = side === "start" ? [x + r, y - 9, x + r + w, y + 9] : [x - r - w, y - 9, x - r, y + 9];
    if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    return side;
  }
  return null;
}
