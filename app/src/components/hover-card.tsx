import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { countryName, pct, usd } from "@/lib/format";
import { countryStats } from "@/lib/stats";

type Edge = { e: string; i: string; v: number; imp_share: number; exp_share: number; rank: number };
type Hover = { kind: "arc"; x: number; y: number; edge: Edge } | { kind: "country"; x: number; y: number; iso3: string };
type Stats = Awaited<ReturnType<typeof countryStats>>;

const cache = new Map<string, Stats>();

// Floating card that follows the pointer over the map canvas (deck.gl picking has no DOM trigger to anchor to).
export function HoverCard({ hover, basket, year, names }: { hover: Hover; basket: string; year: number; names: Map<string, string> }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const iso3 = hover.kind === "country" ? hover.iso3 : null;
  useEffect(() => {
    if (!iso3) return;
    const key = `${iso3}|${basket}|${year}`;
    if (cache.has(key)) return setStats(cache.get(key)!);
    setStats(null);
    countryStats(iso3, basket, year).then((s) => {
      cache.set(key, s);
      setStats(s);
    });
  }, [iso3, basket, year]);

  const name = (c: string) => names.get(c) ?? countryName(c);
  // Keep the card inside the map area (not the window): flip to the left/top of the pointer near edges.
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: hover.x + 16, top: hover.y + 16 });
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const w = el.offsetWidth, h = el.offsetHeight, pw = parent.clientWidth, ph = parent.clientHeight;
    const left = hover.x + 16 + w > pw - 8 ? hover.x - 16 - w : hover.x + 16;
    const top = Math.max(8, Math.min(hover.y + 16, ph - h - 8));
    setPos({ left: Math.max(8, left), top });
  }, [hover.x, hover.y, stats]);

  return (
    <div ref={ref} role="tooltip" className="pointer-events-none absolute z-20 w-80 rounded-lg border bg-popover p-3.5 text-sm text-popover-foreground shadow-2xl" style={pos}>
      {hover.kind === "arc" ? (
        <>
          <p className="font-medium text-foreground">{name(hover.edge.e)} to {name(hover.edge.i)}</p>
          <p className="figure mt-2 text-2xl text-foreground">{usd(hover.edge.v)}</p>
          <dl className="mt-3 space-y-1.5">
            <Row label={`Share of ${name(hover.edge.i)}'s imports`} value={pct(hover.edge.imp_share)} strong />
            <Row label={`Rank among its suppliers`} value={`#${hover.edge.rank}`} />
            <Row label={`Share of ${name(hover.edge.e)}'s exports`} value={pct(hover.edge.exp_share)} />
          </dl>
        </>
      ) : (
        <>
          <p className="font-medium text-foreground">{name(hover.iso3)}</p>
          {!stats ? (
            <p className="mt-2 text-muted-foreground">Loading…</p>
          ) : (
            <>
              {stats.imp && (
                <dl className="mt-2 space-y-1.5">
                  <Row label="Imports" value={usd(stats.imp.imports_kusd)} strong />
                  <Row label="Suppliers" value={String(stats.imp.supplier_count)} />
                  <Row label="Concentration (HHI)" value={stats.imp.hhi_value.toFixed(2)} />
                </dl>
              )}
              {stats.suppliers.length > 0 && <Bars title="Buys most from" rows={stats.suppliers} name={name} />}
              {stats.dependents.length > 0 && <Bars title="Most dependent on it" rows={stats.dependents} name={name} tone="amber" />}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold text-foreground" : "text-foreground"}>{value}</dd>
    </div>
  );
}

function Bars({ title, rows, name, tone }: { title: string; rows: { iso3: string; share: number }[]; name: (c: string) => string; tone?: "amber" }) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {rows.slice(0, 4).map((r) => (
          <li key={r.iso3} className="grid grid-cols-[1fr_auto] items-center gap-x-2">
            <span className="truncate text-foreground">{name(r.iso3)}</span>
            <span className="text-foreground">{pct(r.share, 0)}</span>
            <span className="col-span-2 h-1 overflow-hidden rounded bg-[var(--tg-slate)]">
              <span className="block h-full rounded" style={{ width: `${Math.max(2, r.share * 100)}%`, background: tone === "amber" ? "var(--tg-scenario)" : "var(--tg-observed)" }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
