import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Card that follows the pointer over a canvas and stays inside its positioned parent (flips near edges).
export function PointerCard({ x, y, children, width = "w-72" }: { x: number; y: number; children: ReactNode; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 16, top: y + 16 });
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const w = el.offsetWidth, h = el.offsetHeight, pw = parent.clientWidth, ph = parent.clientHeight;
    const left = x + 16 + w > pw - 8 ? x - 16 - w : x + 16;
    setPos({ left: Math.max(8, left), top: Math.max(8, Math.min(y + 16, ph - h - 8)) });
  }, [x, y, children]);
  return (
    <div ref={ref} role="tooltip" className={`pointer-events-none absolute z-20 ${width} rounded-lg border bg-popover p-3.5 text-sm text-popover-foreground shadow-2xl`} style={pos}>
      {children}
    </div>
  );
}

export function CardRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold text-foreground" : "text-foreground"}>{value}</dd>
    </div>
  );
}
