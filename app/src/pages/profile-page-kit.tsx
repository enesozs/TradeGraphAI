// Small building blocks shared by the profile, movers and EU monthly pages (tables, legends, notices, CSV, colours).
import { csvFormat } from "d3";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { Swatch } from "@/components/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCountryColors, type RGB } from "@/lib/country-colors";
import { cn } from "@/lib/utils";

// Fixed hex tokens (Plot's identity colour scale needs literal colours, not CSS variables).
export const INK = "#0e1519";
export const HAZE = "#93a8ba";
export const OTHERS = "#56636c"; // "All others": recessive grey, never a country colour
export const OBSERVED = "#3a86ff";
export const OBSERVED_LIGHT = "#9cbcff";
export const TEAL = "#2ec4b6";
export const SCENARIO = "#f3a712";
export const WARNING = "#e4572e";

const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

// Country identity colour (same as the trade map). Unknown codes fall back to haze.
export function useColorOf() {
  const colors = useCountryColors();
  return useCallback((iso3: string | null | undefined) => {
    const c = iso3 ? colors?.get(iso3) : undefined;
    return c ? hex(c) : HAZE;
  }, [colors]);
}

export const fmt0 = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? "–" : Math.round(x).toLocaleString("en-US"));
export const pp = (x: number | null | undefined) => (x == null ? "–" : `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} pp`);

export type LegendItem = { label: string; color: string; dashed?: boolean; hollow?: boolean };
export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          {it.dashed != null ? (
            <svg width="18" height="8" aria-hidden><line x1="0" y1="4" x2="18" y2="4" stroke={it.color} strokeWidth="2" strokeDasharray={it.dashed ? "4 3" : undefined} /></svg>
          ) : it.hollow ? (
            <span aria-hidden className="inline-block size-2.5 rounded-full border-2" style={{ borderColor: it.color }} />
          ) : (
            <Swatch color={it.color} />
          )}
          <span className="text-foreground/90">{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <div
      role="note"
      className="rounded-lg border px-4 py-3 text-sm text-foreground/90"
      style={{
        borderColor: `color-mix(in srgb, ${tone === "warning" ? "var(--tg-warning)" : "var(--tg-observed)"} 45%, transparent)`,
        background: `color-mix(in srgb, ${tone === "warning" ? "var(--tg-warning)" : "var(--tg-observed)"} 7%, transparent)`,
      }}
    >
      {children}
    </div>
  );
}

export type Column<T> = { key: string; label: string; numeric?: boolean; render: (row: T) => ReactNode; csv?: (row: T) => string | number | null };

// Scrollable data table. Long tables scroll inside the card instead of stretching the page.
export function DataTable<T>({ columns, rows, rowKey, maxHeight = "28rem", empty = "No recorded rows." }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T, i: number) => string; maxHeight?: string; empty?: ReactNode;
}) {
  return (
    <div className="overflow-auto rounded-lg border bg-card" style={{ maxHeight }}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            {columns.map((c) => <TableHead key={c.key} className={cn("whitespace-nowrap", c.numeric && "text-right")}>{c.label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={columns.length} className="text-muted-foreground">{empty}</TableCell></TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow key={rowKey(r, i)}>
                {columns.map((c) => <TableCell key={c.key} className={cn("whitespace-nowrap", c.numeric && "text-right tabular-nums")}>{c.render(r)}</TableCell>)}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function CsvLink<T>({ columns, rows, filename }: { columns: Column<T>[]; rows: T[]; filename: string }) {
  const onClick = () => {
    const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, c.csv ? c.csv(r) : String(c.render(r) ?? "")])));
    const blob = new Blob([csvFormat(data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <button type="button" onClick={onClick} className="text-sm text-primary underline-offset-4 hover:underline">
      Download CSV
    </button>
  );
}

export function Loading({ label = "Loading data" }: { label?: string }) {
  return <p className="py-8 text-sm text-muted-foreground">{label}…</p>;
}

// The map palette has ten hues, so two countries in one chart can share a colour. Within a chart, a repeated
// colour keeps its hue but is tinted (lighter, then darker) so series stay distinguishable; the legend shows the tint.
function mix(hexColor: string, target: number, t: number) {
  const n = parseInt(hexColor.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (target - c) * t));
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
export function distinctColors(colors: string[]): string[] {
  const seen = new Map<string, number>();
  return colors.map((c) => {
    if (c === OTHERS || c === HAZE) return c;
    const k = seen.get(c) ?? 0;
    seen.set(c, k + 1);
    return k === 0 ? c : k === 1 ? mix(c, 255, 0.55) : mix(c, 0, 0.45);
  });
}

// One full-width row of controls at the top of a page.
export function ControlBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border bg-card/60 px-5 py-4 *:[div]:flex *:[div]:flex-col *:[div]:gap-1.5 *:[div]:space-y-0">{children}</div>;
}
