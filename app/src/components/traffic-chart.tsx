import * as Plot from "@observablehq/plot";
import { useEffect, useRef } from "react";

export type TrafficRow = { week: Date; n_total: number };

// Weekly average of daily transits through one chokepoint (IMF PortWatch), with the 2019–2023 mean as a
// muted reference. One series, so no legend: the heading names it. Crosshair + tip on hover.
export function TrafficChart({ rows, height = 150 }: { rows: TrafficRow[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || rows.length === 0) return;
    const ref19 = rows.filter((r) => r.week.getUTCFullYear() <= 2023);
    const mean = ref19.reduce((s, r) => s + r.n_total, 0) / Math.max(1, ref19.length);
    const draw = () => {
      const chart = Plot.plot({
        width: el.clientWidth,
        height,
        marginLeft: 34,
        marginRight: 8,
        marginTop: 8,
        marginBottom: 22,
        style: { background: "transparent", color: "var(--tg-haze)", fontSize: "11px", fontFamily: "inherit" },
        x: { type: "utc", label: null, ticks: 5 },
        y: { label: null, grid: true, ticks: 4, zero: true },
        marks: [
          Plot.ruleY([mean], { stroke: "var(--tg-haze)", strokeOpacity: 0.55, strokeDasharray: "3,3" }),
          Plot.text([{ x: rows[0].week, y: mean }], { x: "x", y: "y", text: () => "2019–23 average", dy: -7, textAnchor: "start", fill: "var(--tg-haze)" }),
          Plot.lineY(rows, { x: "week", y: "n_total", stroke: "var(--tg-observed)", strokeWidth: 1.6, curve: "monotone-x" }),
          Plot.crosshairX(rows, { x: "week", y: "n_total", color: "var(--tg-paper)", opacity: 0.4 }),
          Plot.tip(rows, Plot.pointerX({
            x: "week",
            y: "n_total",
            title: (d: TrafficRow) => `Week of ${d.week.toISOString().slice(0, 10)}\n${d.n_total.toFixed(1)} transits per day`,
            fill: "var(--popover)",
            stroke: "var(--border)",
          })),
        ],
      });
      el.replaceChildren(chart);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows, height]);
  return <div ref={ref} className="w-full" role="img" aria-label="Weekly average daily transits" />;
}
