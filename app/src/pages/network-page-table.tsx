// Small sortable, scrollable data table used by the Network, Scenarios and Forecast pages
// (every chart there has an equivalent table). Kept next to those pages, not in the shared kit.
import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  label: ReactNode;
  value?: (row: T) => number | string | null | undefined; // used for sorting (and display if no render)
  render?: (row: T) => ReactNode;
  numeric?: boolean;
  sortable?: boolean;
};

export function DataTable<T>({ rows, columns, initialSort, maxHeight = "28rem", rowKey, caption }: {
  rows: T[]; columns: Column<T>[]; initialSort?: { key: string; desc?: boolean }; maxHeight?: string; rowKey: (row: T, i: number) => string; caption?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return rows;
    const v = col.value;
    return rows.toSorted((a, b) => {
      const x = v(a), y = v(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -c : c;
    });
  }, [rows, columns, sort]);
  return (
    <div className="overflow-auto rounded-lg border bg-card/60 [contain:inline-size]" style={{ maxHeight }}>
      <Table aria-label={caption}>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const canSort = c.sortable !== false && !!c.value;
              return (
                <TableHead key={c.key} className={cn("whitespace-nowrap", c.numeric && "text-right")} aria-sort={active ? (sort!.desc ? "descending" : "ascending") : undefined}>
                  {canSort ? (
                    <button
                      type="button"
                      className={cn("inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", active && "text-foreground")}
                      onClick={() => setSort(active ? { key: c.key, desc: !sort!.desc } : { key: c.key, desc: !!c.numeric })}
                    >
                      {c.label}
                      <span aria-hidden className="w-2 text-[10px]">{active ? (sort!.desc ? "▾" : "▴") : ""}</span>
                    </button>
                  ) : c.label}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r, i) => (
            <TableRow key={rowKey(r, i)}>
              {columns.map((c) => (
                <TableCell key={c.key} className={cn("whitespace-nowrap", c.numeric && "text-right tabular-nums")}>
                  {c.render ? c.render(r) : String(c.value?.(r) ?? "–")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// Plot.legend mounted in React (for colour scales drawn outside Plot, e.g. hand-built SVG maps and networks).
export function PlotLegend({ options, deps }: { options: NonNullable<Parameters<typeof Plot.legend>[0]>; deps: unknown[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const node = Plot.legend({ ...options, style: { background: "transparent", color: "var(--tg-haze)", fontSize: "12px", fontFamily: "inherit" } });
    el.replaceChildren(node as Node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <div ref={ref} />;
}

// A neutral key line: a short line sample + label, for legends of hand-drawn marks.
export function LineKey({ color, dash, width = 2, children }: { color: string; dash?: string; width?: number; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <svg width="26" height="8" aria-hidden><line x1="1" y1="4" x2="25" y2="4" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" /></svg>
      {children}
    </span>
  );
}

export const fmtInt = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? "–" : Math.round(x).toLocaleString("en-US"));
export const fmtRatio = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "–" : `${x.toFixed(2)}×`);
