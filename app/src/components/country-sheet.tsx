import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { countryName, pct, usd } from "@/lib/format";
import { countryStats } from "@/lib/stats";

type Stats = Awaited<ReturnType<typeof countryStats>>;

export function CountrySheet({ iso3, basket, basketLabel, year, names, onClose }: {
  iso3: string | null; basket: string; basketLabel: string; year: number | null; names?: Map<string, string>; onClose: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    if (!iso3 || year == null) return;
    setStats(null);
    countryStats(iso3, basket, year).then(setStats);
  }, [iso3, basket, year]);
  const name = (c: string) => names?.get(c) ?? countryName(c);

  return (
    <Sheet open={iso3 != null} onOpenChange={(open) => !open && onClose()}>
      <SheetPopup side="right">
        <SheetHeader>
          <SheetTitle>{iso3 ? name(iso3) : ""}</SheetTitle>
          <SheetDescription>{basketLabel}, {year}</SheetDescription>
        </SheetHeader>
        <SheetPanel>
          {!stats ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-6">
              {stats.imp ? (
                <div className="grid grid-cols-3 gap-3">
                  <Figure label="Imports" value={usd(stats.imp.imports_kusd)} />
                  <Figure label="Suppliers" value={String(stats.imp.supplier_count)} />
                  <Figure label="HHI" value={stats.imp.hhi_value.toFixed(2)} />
                </div>
              ) : (
                <p className="text-muted-foreground">No recorded imports of this basket in {year}. Missing is not zero.</p>
              )}
              <ShareList title="Where its imports come from" rows={stats.suppliers} name={name} />
              <ShareList title="Countries most dependent on it as a supplier" rows={stats.dependents} name={name} amber
                note="Share of each importer's own imports of this basket (importers above $50 m)." />
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Observed</Badge>
                <Link className="text-sm text-[var(--tg-observed)] underline underline-offset-2" to={`/profile?country=${iso3}&basket=${basket}`}>Open full dependency profile</Link>
              </div>
            </div>
          )}
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[var(--tg-slate)]/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="figure mt-1 text-xl text-foreground">{value}</p>
    </div>
  );
}

function ShareList({ title, rows, name, amber, note }: { title: string; rows: { iso3: string; share: number; v: number }[]; name: (c: string) => string; amber?: boolean; note?: string }) {
  if (!rows.length) return null;
  return (
    <div>
      <h3 className="mb-2 font-medium text-foreground">{title}</h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.iso3}>
            <div className="flex justify-between text-sm"><span className="text-foreground">{name(r.iso3)}</span><span className="text-muted-foreground">{usd(r.v)} · <span className="text-foreground">{pct(r.share)}</span></span></div>
            <div className="mt-1 h-1.5 rounded bg-[var(--tg-slate)]"><div className="h-full rounded" style={{ width: `${Math.max(1.5, r.share * 100)}%`, background: amber ? "var(--tg-scenario)" : "var(--tg-observed)" }} /></div>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
