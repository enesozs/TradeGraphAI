import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Page, Section, Swatch } from "@/components/page";
import { PlotFigure, TIP } from "@/components/plot-figure";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@/lib/db";
import { countryName, pct, usd } from "@/lib/format";
import { useBuildInfo, type BuildInfo } from "@/lib/meta";
import { ControlBar, CsvLink, DataTable, Loading, distinctColors, pp, useColorOf, type Column } from "./profile-page-kit";

// build_info.json carries the movers windows; the shared BuildInfo type doesn't declare them.
type MoversInfo = { start_years: [number, number]; end_years: [number, number]; min_imports_kusd: number };
type Info = BuildInfo & { movers?: MoversInfo };

type MI = {
  basket_id: string; importer_iso3: string; importer_name: string; start_imports_kusd: number; end_imports_kusd: number;
  start_hhi: number; end_hhi: number; delta_hhi: number; start_top1_share: number; end_top1_share: number; delta_top1_share: number;
};
type MS = {
  basket_id: string; importer_iso3: string; supplier_iso3: string; supplier_name: string; start_share: number; end_share: number;
  delta_share: number; years_present_start: number; years_present_end: number;
};

const ALL = "__all";
const win = (w?: [number, number]) => (w ? `${w[0]}–${w[1]}` : "");
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const profileHref = (iso3: string, basket: string) => `/profile?country=${iso3}&basket=${basket}`;

export function MoversPage() {
  const info = useBuildInfo() as Info | null;
  const colorOf = useColorOf();
  const [basket, setBasket] = useState<string>(ALL);
  const mv = info?.movers;
  const where = basket === ALL ? "" : "WHERE basket_id = ?";
  const args = basket === ALL ? [] : [basket];
  const impQ = useQuery<MI>(`SELECT * FROM movers_importer ${where}`, args);
  const supQ = useQuery<MS>(`SELECT * FROM movers_supplier ${where} ORDER BY abs(delta_share) DESC LIMIT 300`, args);

  const basketOf = useMemo(() => new Map((info?.baskets ?? []).map((b) => [b.id, b])), [info]);
  const imp = useMemo(() => (impQ.data ?? []).map((d) => {
    const b = basketOf.get(d.basket_id);
    const importer = countryName(d.importer_iso3, d.importer_name);
    const sl = b?.short_label ?? short(b?.label ?? d.basket_id, 16);
    return { ...d, importer, basket: b?.label ?? d.basket_id, keyWide: basket === ALL ? `${short(importer, 22)} (${sl})` : short(importer, 28), keyNarrow: basket === ALL ? `${d.importer_iso3} (${sl})` : d.importer_iso3 };
  }), [impQ.data, basketOf, basket]);
  type Pair = (typeof imp)[number];
  const withColors = (rows: Pair[]) => {
    const cols = distinctColors(rows.map((d) => colorOf(d.importer_iso3)));
    return rows.map((d, i) => ({ ...d, color: cols[i] }));
  };
  const up = useMemo(() => withColors([...imp].sort((a, b) => b.delta_hhi - a.delta_hhi).slice(0, 15).filter((d) => d.delta_hhi > 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imp, colorOf]);
  const down = useMemo(() => withColors([...imp].sort((a, b) => a.delta_hhi - b.delta_hhi).slice(0, 15).filter((d) => d.delta_hhi < 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imp, colorOf]);

  const barChart = (data: (Pair & { color: string })[], label: string) => (
    <PlotFigure
      label={label}
      deps={[data]}
      make={(width) => {
        const narrow = width < 520;
        const key = narrow ? "keyNarrow" : "keyWide";
        const ext = Math.max(0.05, ...data.map((d) => Math.abs(d.delta_hhi)));
        const neg = data[0]?.delta_hhi < 0;
        return {
          width, height: 24 * data.length + 40, marginLeft: narrow ? 100 : 200, marginRight: neg ? 16 : 52,
          x: { label: "Change in HHI", domain: neg ? [-ext * 1.18, 0] : [0, ext], grid: true, ticks: 4 },
          y: { label: null, domain: data.map((d) => d[key]), tickSize: 0 },
          color: { type: "identity" },
          marks: [
            Plot.barX(data, { y: key, x: "delta_hhi", fill: "color", fillOpacity: 0.9, insetTop: 3, insetBottom: 3 }),
            Plot.text(data, { y: key, x: "delta_hhi", text: (d) => `${d.delta_hhi >= 0 ? "+" : ""}${d.delta_hhi.toFixed(2)}`, dx: neg ? -5 : 5, textAnchor: neg ? "end" : "start", fill: "var(--tg-paper)" }),
            Plot.ruleX([0], { stroke: "currentColor", strokeOpacity: 0.5 }),
            Plot.tip(data, Plot.pointerY({
              y: key, x: "delta_hhi", ...TIP,
              title: (d) => `${d.importer}, ${d.basket}\nHHI ${d.start_hhi.toFixed(2)} to ${d.end_hhi.toFixed(2)}\nImports ${usd(d.start_imports_kusd)} to ${usd(d.end_imports_kusd)} per year`,
            })),
          ],
        };
      }}
    />
  );

  const supCols: Column<MS>[] = [
    { key: "b", label: "Basket", render: (d) => basketOf.get(d.basket_id)?.label ?? d.basket_id },
    { key: "i", label: "Importer", render: (d) => <Link to={profileHref(d.importer_iso3, d.basket_id)} className="text-primary underline-offset-4 hover:underline">{d.importer_iso3}</Link>, csv: (d) => d.importer_iso3 },
    { key: "s", label: "Supplier", render: (d) => <span className="flex items-center gap-2"><Swatch color={colorOf(d.supplier_iso3)} />{countryName(d.supplier_iso3, d.supplier_name)}</span>, csv: (d) => countryName(d.supplier_iso3, d.supplier_name) },
    { key: "s0", label: `Share ${win(mv?.start_years)}`, numeric: true, render: (d) => pct(d.start_share), csv: (d) => d.start_share },
    { key: "s1", label: `Share ${win(mv?.end_years)}`, numeric: true, render: (d) => pct(d.end_share), csv: (d) => d.end_share },
    { key: "d", label: "Change", numeric: true, render: (d) => pp(d.delta_share), csv: (d) => d.delta_share },
    { key: "y", label: "Years with data", numeric: true, render: (d) => `${d.years_present_start} / ${d.years_present_end}` },
  ];
  const full = useMemo(() => [...imp].sort((a, b) => Math.abs(b.delta_hhi) - Math.abs(a.delta_hhi)), [imp]);
  const fullCols: Column<Pair>[] = [
    { key: "b", label: "Basket", render: (d) => d.basket },
    { key: "i", label: "Importer", render: (d) => <Link to={profileHref(d.importer_iso3, d.basket_id)} className="flex items-center gap-2 text-foreground underline-offset-4 hover:underline"><Swatch color={colorOf(d.importer_iso3)} />{d.importer}</Link>, csv: (d) => d.importer },
    { key: "iso", label: "ISO3", render: (d) => <span className="text-muted-foreground">{d.importer_iso3}</span>, csv: (d) => d.importer_iso3 },
    { key: "h0", label: `HHI ${win(mv?.start_years)}`, numeric: true, render: (d) => d.start_hhi.toFixed(3), csv: (d) => d.start_hhi },
    { key: "h1", label: `HHI ${win(mv?.end_years)}`, numeric: true, render: (d) => d.end_hhi.toFixed(3), csv: (d) => d.end_hhi },
    { key: "dh", label: "Change in HHI", numeric: true, render: (d) => `${d.delta_hhi >= 0 ? "+" : ""}${d.delta_hhi.toFixed(3)}`, csv: (d) => d.delta_hhi },
    { key: "t0", label: `Top-1 ${win(mv?.start_years)}`, numeric: true, render: (d) => pct(d.start_top1_share), csv: (d) => d.start_top1_share },
    { key: "t1", label: `Top-1 ${win(mv?.end_years)}`, numeric: true, render: (d) => pct(d.end_top1_share), csv: (d) => d.end_top1_share },
    { key: "v", label: `Imports per year ${win(mv?.end_years)}`, numeric: true, render: (d) => usd(d.end_imports_kusd), csv: (d) => d.end_imports_kusd },
  ];

  const basketItems = [{ value: ALL, label: "All baskets" }, ...(info?.baskets ?? []).map((b) => ({ value: b.id, label: b.label }))];

  return (
    <Page
      title="Biggest movers"
      lead={mv ? `Where did supplier concentration change most between ${win(mv.start_years)} and ${win(mv.end_years)}?` : "Where did supplier concentration change most?"}
      meta={info && mv && (
        <>
          <Badge variant="outline" className="border-[var(--tg-observed)] text-[var(--tg-observed)]">Observed</Badge>
          <Badge variant="outline">CEPII BACI {info.source.hs_revision}, release {info.source.release}</Badge>
          <Badge variant="outline">Averages {win(mv.start_years)} vs {win(mv.end_years)}</Badge>
          <Badge variant="outline">Pairs with at least {usd(mv.min_imports_kusd)} imports per year in both windows and data in every year</Badge>
        </>
      )}
    >
      <ControlBar>
        <div className="space-y-1.5">
          <Label>Product basket</Label>
          <Select items={basketItems} value={basket} onValueChange={(v) => v && setBasket(v as string)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectPopup>{basketItems.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}</SelectPopup>
          </Select>
        </div>
        <p className="max-w-2xl flex-1 text-sm text-muted-foreground">
          Each figure is an average over the window years. HHI runs from near 0 (many suppliers) to 1 (a single supplier), with shares over all partner countries.
          A change in concentration describes the data; it doesn't say why it changed. Open a pair in the <Link to="/profile" className="text-primary underline-offset-4 hover:underline">Dependency profile</Link> to see its full history before drawing any conclusion.
        </p>
      </ControlBar>

      {!info || impQ.loading ? <Loading /> : (
        <>
          <div className="grid gap-10 lg:grid-cols-2">
            <Section title="Most concentrated over time" description="Largest increases in HHI by value. Bar colour is the importer's colour on the trade map." note={`${up.length} of ${imp.length} pairs shown.`}>
              {up.length ? barChart(up, "Importer and basket pairs with the largest increase in supplier concentration") : <p className="text-sm text-muted-foreground">No pair became more concentrated.</p>}
            </Section>
            <Section title="Most diversified over time" description="Largest decreases in HHI by value. Bar colour is the importer's colour on the trade map." note={`${down.length} of ${imp.length} pairs shown.`}>
              {down.length ? barChart(down, "Importer and basket pairs with the largest decrease in supplier concentration") : <p className="text-sm text-muted-foreground">No pair became less concentrated.</p>}
            </Section>
          </div>

          <Section
            title="Largest supplier-share shifts"
            description={`The supplier's share of the importer's recorded imports, averaged over each window (${win(mv?.start_years)} and ${win(mv?.end_years)}). The 300 largest absolute changes.`}
            note={'A year with no recorded flow counts as 0% share in the average. "Years with data" shows how many years in each window had a flow, so a low count means the average rests on few observations.'}
          >
            {supQ.loading ? <Loading /> : <DataTable columns={supCols} rows={supQ.data ?? []} rowKey={(d) => `${d.basket_id}-${d.importer_iso3}-${d.supplier_iso3}`} />}
          </Section>

          <Section title={`All pairs (${imp.length})`} description="Every importer and basket pair that passes the size and completeness filter, sorted by the absolute change in HHI. Select an importer to open its profile.">
            <DataTable columns={fullCols} rows={full} rowKey={(d) => `${d.basket_id}-${d.importer_iso3}`} />
            <CsvLink columns={fullCols} rows={full} filename="tradegraph_movers.csv" />
          </Section>
        </>
      )}
    </Page>
  );
}
