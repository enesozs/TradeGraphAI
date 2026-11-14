import * as Plot from "@observablehq/plot";
import { useEffect, useRef } from "react";

// Observable Plot in React: redraws on resize; theme (transparent background, haze axes, app font) applied here.
// `make(width)` returns the Plot options; keep it pure. Give every chart an aria-label and a table elsewhere.
export function PlotFigure({ make, label, deps }: { make: (width: number) => Plot.PlotOptions; label: string; deps: unknown[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const draw = () => {
      const opts = make(Math.max(280, el.clientWidth));
      const chart = Plot.plot({
        ...opts,
        style: { background: "transparent", color: "var(--tg-haze)", fontSize: "12px", fontFamily: "inherit", overflow: "visible", ...(typeof opts.style === "object" ? opts.style : {}) },
      });
      el.replaceChildren(chart);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <div ref={ref} className="w-full [&_[aria-label=tip]]:text-foreground" role="img" aria-label={label} />;
}

// Tip styling that matches the app's popovers.
export const TIP = { fill: "var(--popover)", stroke: "var(--border)" } as const;
