// Shared "observatory" canvas: dark background, faint grid, glow filters and a community palette.
// Used by the Network and Map pages. Colours are vivid on dark backgrounds; every element keeps a <title>.
import * as d3 from "npm:d3";

export const CANVAS = {bg: "#0d1418", grid: "#ffffff12", land: "#1b2830", landEdge: "#0d1418", ocean: "#0a1013", text: "#e6edf0", muted: "#9fb0b8"};

// Ten distinguishable hues for communities (ordered by community size), then grey for the rest.
export const PALETTE = ["#ff4d6d", "#4dd4ac", "#5aa9ff", "#ffb84d", "#c77dff", "#f2e85c", "#ff8fab", "#7ee081", "#56cfe1", "#ff9e7a"];
export const communityColor = (c) => (c == null || c < 0 ? "#6c7a80" : PALETTE[c % PALETTE.length]);

export function addDefs(svg, id) {
  const defs = svg.append("defs");
  const glow = defs.append("filter").attr("id", `${id}-glow`).attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
  glow.append("feGaussianBlur").attr("stdDeviation", 2.2).attr("result", "blur");
  const merge = glow.append("feMerge");
  merge.append("feMergeNode").attr("in", "blur");
  merge.append("feMergeNode").attr("in", "SourceGraphic");
  return {glow: `url(#${id}-glow)`};
}

export function background(svg, width, height, step = 80) {
  svg.append("rect").attr("width", width).attr("height", height).attr("fill", CANVAS.bg);
  const g = svg.append("g").attr("stroke", CANVAS.grid).attr("stroke-width", 1);
  for (let x = step; x < width; x += step) g.append("line").attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", height);
  for (let y = step; y < height; y += step) g.append("line").attr("y1", y).attr("y2", y).attr("x1", 0).attr("x2", width);
  const dots = svg.append("g").attr("fill", "#ffffff2a");
  for (let x = step; x < width; x += step) for (let y = step; y < height; y += step) dots.append("circle").attr("cx", x).attr("cy", y).attr("r", 1.4);
}

// A tag-style label like "China cluster · $312 bn".
export function tag(parent, x, y, text, color) {
  const g = parent.append("g").attr("transform", `translate(${x},${y})`).attr("pointer-events", "none");
  const t = g.append("text").attr("x", 6).attr("y", 4).attr("fill", CANVAS.text).attr("font-size", 12).attr("font-family", "var(--sans-serif)").text(text);
  const w = text.length * 6.6 + 12;
  g.insert("rect", "text").attr("x", 0).attr("y", -10).attr("width", w).attr("height", 20).attr("rx", 3).attr("fill", "#000000b0").attr("stroke", color).attr("stroke-opacity", 0.6);
  return g;
}

// Curved arc from a to b in screen space (bow to the left of travel direction).
export function arcPath([x1, y1], [x2, y2], bow = 0.22) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1;
  const cx = mx - dy * bow, cy = my + dx * bow;
  return `M${x1},${y1}Q${cx},${cy} ${x2},${y2}`;
}

export const usd = (k) => {
  if (k == null || isNaN(k)) return "–";
  const v = k * 1e3;
  return v >= 1e12 ? `$${(v / 1e12).toFixed(2)} tn` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)} bn` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)} m` : `$${(v / 1e3).toFixed(0)} k`;
};
