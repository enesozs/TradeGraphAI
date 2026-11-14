import * as Plot from "@observablehq/plot";
import { utcFormat } from "d3";
import { useMemo, useState } from "react";
import { BasketSelect } from "@/components/controls";
import { Page, Section, Stat, Swatch } from "@/components/page";
import { PlotFigure, TIP } from "@/components/plot-figure";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useJson, useQuery } from "@/lib/db";
import { eur, pct, usd } from "@/lib/format";
import { useGeo } from "@/lib/geo";
import { useBuildInfo } from "@/lib/meta";
import { ControlBar, DataTable, INK, Legend, Loading, OBSERVED, OTHERS, TEAL, distinctColors, fmt0, useColorOf, type Column } from "./profile-page-kit";

type Incomplete = { reporter: string; month: string; intra_eu_records_vs_usual: number | null; extra_eu_records_vs_usual: number | null };
type ComextInfo = {
  source: string; eurostat_last_update: string; first_month: string; latest_month: string; reporters: string[];
  units: { value: string; quantity: string }; min_month_coverage?: number; incomplete_months?: Incomplete[];
};
type Imp = { month: number | string; imports_eur: number; supplier_count: number; hhi: number | null; top1_iso3: string | null; top1_share: number | null; hhi_12m: number | null; top1_iso3_12m: string | null; top1_share_12m: number | null };
// value_eur is empty for a partner with imports in the trailing 12 months but none recorded in the month itself.
type Sup = { month: number | string; partner_iso3: string; value_eur: number | null; qty_100kg: number | null; share: number | null; value_eur_12m: number | null; share_12m: number | null };
type View = "ttm" | "month";

const REPORTER_LABEL: Record<string, string> = {
  EU27_2020_EXTRA: "EU27, imports from outside the EU", EU27_2020: "EU27, all partners (incl. intra-EU)",
  DE: "Germany", FR: "France", IT: "Italy", NL: "Netherlands", ES: "Spain", PL: "Poland",
};
// For sentences: the reporter labels above read badly as possessives ("EU27, imports from outside the EU's ...").
const ownerOf = (reporter: string) => (reporter.startsWith("EU27") ? "the EU's" : `${REPORTER_LABEL[reporter] ?? reporter}'s`);
const importsOf = (reporter: string) =>
  reporter === "EU27_2020_EXTRA" ? "the EU's imports from outside the EU"
    : reporter === "EU27_2020" ? "the EU's imports, including trade between member states"
      : `${ownerOf(reporter)} imports`;
const monthFmt = utcFormat("%b %Y");
const MONTH_NAME = (m: number) => utcFormat("%B")(new Date(Date.UTC(2000, m - 1)));

export function EuMonthlyPage() {
  const info = useBuildInfo();
  const cx = useJson<ComextInfo>("comext_info.json");
  const geo = useGeo();
  const colorOf = useColorOf();
  const [reporter, setReporter] = useState("EU27_2020_EXTRA");
  const [basket, setBasket] = useState("li_ion_batteries");
  const [view, setView] = useState<View>("ttm");
  const ttm = view === "ttm";
  const nameOf = (iso3: string | null | undefined) => (iso3 ? geo?.names.get(iso3) ?? iso3 : "–");

  const impQ = useQuery<Imp>(`SELECT * FROM comext_importer WHERE reporter = ? AND basket_id = ? ORDER BY month`, [reporter, basket]);
  // Shares are derived here (value over the month's total) to keep the file small.
  const supQ = useQuery<Sup>(
    `SELECT *, value_eur / sum(value_eur) OVER (PARTITION BY month) AS share, value_eur_12m / sum(value_eur_12m) OVER (PARTITION BY month) AS share_12m
     FROM comext_supplier WHERE reporter = ? AND basket_id = ? ORDER BY month`,
    [reporter, basket],
  );
  // The marts hold fully published months only; months Eurostat has only partly published are listed in comext_info.
  const series = useMemo(() => (impQ.data ?? []).map((d) => ({ ...d, month: new Date(d.month) })), [impQ.data]);
  const supRows = useMemo(() => (supQ.data ?? []).map((d) => ({ ...d, month: new Date(d.month) })), [supQ.data]);
  const heldBack = (cx?.incomplete_months ?? []).filter((d) => d.reporter === reporter);
  const latest = series.at(-1);
  const yearAgo = latest && series.find((d) => d.month.getUTCFullYear() === latest.month.getUTCFullYear() - 1 && d.month.getUTCMonth() === latest.month.getUTCMonth());
  const top1 = ttm ? latest?.top1_iso3_12m : latest?.top1_iso3;
  const shareKey = ttm ? "share_12m" : "share";

  // Supplier mix: six largest partners over the period + all others (shares summed within each month).
  const mix = useMemo(() => {
    const valid = supRows.filter((d) => d[shareKey] != null);
    const totals = new Map<string, number>();
    for (const d of valid) totals.set(d.partner_iso3, (totals.get(d.partner_iso3) ?? 0) + ((ttm ? d.value_eur_12m : d.value_eur) ?? 0));
    const top6 = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    const agg = new Map<string, { month: Date; key: string; v: number }>();
    for (const d of valid) {
      const key = top6.includes(d.partner_iso3) ? d.partner_iso3 : "OTHERS";
      const id = `${+d.month}|${key}`;
      const r = agg.get(id) ?? { month: d.month, key, v: 0 };
      r.v += d[shareKey] ?? 0;
      agg.set(id, r);
    }
    const order = [...top6, "OTHERS"];
    const label = (k: string) => (k === "OTHERS" ? "All others" : nameOf(k));
    const cols = distinctColors(order.map((k) => (k === "OTHERS" ? OTHERS : colorOf(k))));
    const legend = order.map((k, i) => ({ key: k, label: label(k), color: cols[i] }));
    // A partner with no share in a month counts as 0 of that month's recorded imports, so every stack stays closed.
    for (const m of new Set([...agg.values()].map((r) => +r.month)))
      for (const key of order) if (!agg.has(`${m}|${key}`)) agg.set(`${m}|${key}`, { month: new Date(m), key, v: 0 });
    const rows = [...agg.values()].map((r) => ({ ...r, supplier: label(r.key) })).sort((a, b) => +a.month - +b.month);
    return { rows, legend };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supRows, shareKey, ttm, colorOf, geo]);

  const conc = useMemo(() => series.flatMap((d) => [
    { month: d.month, metric: "HHI", v: ttm ? d.hhi_12m : d.hhi },
    { month: d.month, metric: "Largest supplier share", v: ttm ? d.top1_share_12m : d.top1_share, who: ttm ? d.top1_iso3_12m : d.top1_iso3 },
  ]).filter((d) => d.v != null) as { month: Date; metric: string; v: number; who?: string | null }[], [series, ttm]);

  type LastRow = (typeof supRows)[number];
  const lastRows = useMemo(() => supRows.filter((d) => latest && +d.month === +latest.month && d.value_eur != null).sort((a, b) => (b.value_eur ?? 0) - (a.value_eur ?? 0)), [supRows, latest]);
  const cols: Column<LastRow>[] = [
    { key: "s", label: "Supplier", render: (d) => <span className="flex items-center gap-2"><Swatch color={colorOf(d.partner_iso3)} />{nameOf(d.partner_iso3)}</span> },
    { key: "iso", label: "ISO3", render: (d) => <span className="text-muted-foreground">{d.partner_iso3}</span> },
    { key: "v", label: "Value (EUR)", numeric: true, render: (d) => fmt0(d.value_eur) },
    { key: "sm", label: "Share (month)", numeric: true, render: (d) => pct(d.share) },
    { key: "s12", label: "Share (12 months)", numeric: true, render: (d) => pct(d.share_12m) },
    { key: "q", label: "Quantity (100 kg)", numeric: true, render: (d) => fmt0(d.qty_100kg) },
  ];

  const reporters = (cx?.reporters ?? []).slice().sort((a, b) => (a === "EU27_2020_EXTRA" ? -1 : b === "EU27_2020_EXTRA" ? 1 : 0));
  const reporterItems = reporters.map((r) => ({ value: r, label: REPORTER_LABEL[r] ?? r }));
  const reporterLabel = REPORTER_LABEL[reporter] ?? reporter;
  const basketLabel = info?.baskets.find((b) => b.id === basket)?.label ?? basket;
  const loading = !cx || !info || impQ.loading || supQ.loading;

  return (
    <Page
      title="EU monthly monitor"
      lead="Who supplies Europe, month by month? Eurostat customs data, updated monthly, as an early read ahead of the annual BACI release."
      meta={cx && (
        <>
          <Badge variant="outline" className="border-[var(--tg-observed)] text-[var(--tg-observed)]">Observed</Badge>
          <Badge variant="outline">Eurostat Comext DS-045409, values in EUR</Badge>
          <Badge variant="outline">Data to {monthFmt(latest ? latest.month : new Date(cx.latest_month))} (Eurostat update {cx.eurostat_last_update})</Badge>
          <Badge variant="outline">Separate source: not directly comparable with the BACI pages (USD, reconciled, annual)</Badge>
        </>
      )}
    >
      <ControlBar>
        <div className="space-y-1.5">
          <Label>Importer</Label>
          <Select items={reporterItems} value={reporter} onValueChange={(v) => v && setReporter(v as string)}>
            <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
            <SelectPopup>{reporterItems.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}</SelectPopup>
          </Select>
        </div>
        <BasketSelect info={info} value={basket} onChange={setBasket} />
        <div className="space-y-1.5">
          <Label>View</Label>
          <ToggleGroup value={[view]} onValueChange={(v) => v[0] && setView(v[0] as View)} aria-label="View">
            <ToggleGroupItem value="ttm">Trailing 12 months</ToggleGroupItem>
            <ToggleGroupItem value="month">Single month</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </ControlBar>

      {loading ? <Loading /> : !latest ? (
        <p className="text-sm text-muted-foreground">No recorded imports for {reporterLabel} in this basket. Missing flows are not recorded, which is not the same as zero.</p>
      ) : (
        <>
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground">{reporterLabel}, {basketLabel}</h2>
            {heldBack.length > 0 && cx && <HeldBack months={heldBack} reporterLabel={reporterLabel} threshold={cx.min_month_coverage ?? 0.5} />}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label={`Imports, ${monthFmt(latest.month)}`}
                value={eur(latest.imports_eur)}
                context={yearAgo ? `${latest.imports_eur >= yearAgo.imports_eur ? "+" : ""}${pct(latest.imports_eur / yearAgo.imports_eur - 1)} vs ${monthFmt(yearAgo.month)}` : "No year-earlier month"}
              />
              <Stat
                label={`Largest supplier${ttm ? ", 12 months" : `, ${monthFmt(latest.month)}`}`}
                value={pct(ttm ? latest.top1_share_12m : latest.top1_share)}
                accent={top1 ? colorOf(top1) : undefined}
                context={<span className="flex items-center gap-1.5">{top1 && <Swatch color={colorOf(top1)} />}{nameOf(top1)}</span>}
              />
              <Stat label={`Concentration (HHI)${ttm ? ", 12 months" : ""}`} value={(ttm ? latest.hhi_12m : latest.hhi)?.toFixed(2) ?? "–"} context="Near 0 is dispersed, 1 is a single supplier" />
              <Stat label={`Suppliers, ${monthFmt(latest.month)}`} value={latest.supplier_count} context="Partner countries with recorded imports" />
            </div>
          </div>

          <div className="grid gap-10 lg:grid-cols-2">
            <Section
              title={`Supplier mix, ${ttm ? "trailing 12 months" : "monthly"}`}
              description={`Share of ${importsOf(reporter)} by value (EUR), from the six largest partners over the period, plus all others. Colours match the trade map.`}
            >
              <Legend items={mix.legend.map((l) => ({ label: l.label, color: l.color }))} />
              <PlotFigure
                label={`Monthly supplier mix of ${reporterLabel}'s imports`}
                deps={[mix]}
                make={(width) => ({
                  width, height: 300, marginLeft: 40, marginRight: 12,
                  x: { label: null, type: "utc", ticks: width < 500 ? 4 : 7 },
                  y: { label: "Share of imports", tickFormat: "%", grid: true },
                  color: { domain: mix.legend.map((l) => l.label), range: mix.legend.map((l) => l.color) },
                  marks: [
                    Plot.areaY(mix.rows, Plot.stackY({ order: mix.legend.map((l) => l.label) }, { x: "month", y: "v", fill: "supplier", fillOpacity: 0.85, stroke: INK, strokeWidth: 0.5, curve: "step" })),
                    Plot.tip(mix.rows, Plot.pointer(Plot.stackY({ order: mix.legend.map((l) => l.label) }, {
                      x: "month", y: "v", z: "supplier", ...TIP,
                      title: (d: (typeof mix.rows)[number]) => `${d.supplier}, ${monthFmt(d.month)}\n${pct(d.v)}`,
                    }))),
                  ],
                })}
              />
            </Section>

            <Section
              title="Concentration over time"
              description={`HHI and largest-supplier share, ${ttm ? "on trailing 12-month sums" : "month by month"}.`}
              note="Shares and HHI use imports from all partner countries in the Comext extract."
            >
              <Legend items={[{ label: "HHI", color: OBSERVED, dashed: false }, { label: "Largest supplier share", color: TEAL, dashed: false }]} />
              <PlotFigure
                label={`Supplier concentration of ${reporterLabel}'s imports by month`}
                deps={[conc]}
                make={(width) => ({
                  width, height: 300, marginLeft: 36, marginRight: 12,
                  x: { label: null, type: "utc", ticks: width < 500 ? 4 : 7 },
                  y: { label: "Index or share", domain: [0, 1], grid: true },
                  color: { domain: ["HHI", "Largest supplier share"], range: [OBSERVED, TEAL] },
                  marks: [
                    Plot.lineY(conc, { x: "month", y: "v", stroke: "metric", strokeWidth: 1.5, curve: "step-after" }),
                    Plot.tip(conc, Plot.pointer({
                      x: "month", y: "v", ...TIP,
                      title: (d) => `${d.metric}, ${monthFmt(d.month)}\n${d.metric === "HHI" ? d.v.toFixed(3) : `${pct(d.v)} (${nameOf(d.who)})`}`,
                    })),
                  ],
                })}
              />
            </Section>
          </div>

          <Section title={`Suppliers, ${monthFmt(latest.month)}`} description={`${lastRows.length} partner countries with recorded imports in the latest month, by value.`}>
            <DataTable columns={cols} rows={lastRows} rowKey={(d) => d.partner_iso3} />
          </Section>

          {reporter !== "EU27_2020" && (
            <ArrivalSection reporter={reporter} reporterLabel={reporterLabel} basket={basket} basketLabel={basketLabel} nameOf={nameOf} colorOf={colorOf} />
          )}

          {reporter !== "EU27_2020" && (
            <NowcastSection reporter={reporter} reporterLabel={reporterLabel} basket={basket} basketLabel={basketLabel} nameOf={nameOf} colorOf={colorOf} />
          )}
        </>
      )}

      <p className="max-w-3xl text-sm text-muted-foreground">
        Import values as declared by EU member states (Eurostat customs statistics, EUR, current prices). They are not reconciled with exporters' reports the way BACI is, so levels and shares can differ from the annual pages. Single months are noisy; the trailing-12-month view sums the latest 12 months. Taiwan is shown as "Taiwan (Other Asia, nes)" for consistency with BACI. Source: Eurostat, Comext DS-045409, © European Union, adapted by TradeGraph AI. Monthly US data (US Census Bureau) is planned and will be added when an API key is configured.
      </p>
    </Page>
  );
}

type NowTotal = { year: number; kind: "observed" | "nowcast"; value_kusd: number; lo_kusd: number | null; hi_kusd: number | null; months: number; provisional: boolean };
type NowSup = { year: number; partner_iso3: string; value_kusd: number; share: number; baci_share: number | null };
type NowMetrics = {
  baci_last_year: number; comext_last_month: number; nowcast_years: number[];
  backtest: { test_years: number[]; metrics: Record<"full_lag1" | "partial_lag2", Record<"fx_only" | "last_ratio" | "learned", { median_abs_error: number; top_supplier_share_mae_pp: number; n_cells: number }>> };
  caveats: string[];
};
const NOW = "#c9a7ff"; // nowcast: a distinct, lighter hue; dashed marks

// ML B: annual imports on the BACI basis (USD, reconciled) for the years BACI hasn't published yet, estimated from
// the monthly Eurostat data. EU scope only. Clearly separated from observed values: dashed, banded, labelled.
function NowcastSection({ reporter, reporterLabel, basket, basketLabel, nameOf, colorOf }: {
  reporter: string; reporterLabel: string; basket: string; basketLabel: string;
  nameOf: (iso3: string | null | undefined) => string; colorOf: (iso3: string) => string;
}) {
  const m = useJson<NowMetrics>("nowcast_metrics.json");
  const totQ = useQuery<NowTotal>(`SELECT year, kind, value_kusd, lo_kusd, hi_kusd, months, provisional FROM nowcast_totals WHERE reporter = ? AND basket_id = ? ORDER BY year`, [reporter, basket]);
  const supQ = useQuery<NowSup>(`SELECT year, partner_iso3, value_kusd, share, baci_share FROM nowcast_suppliers WHERE reporter = ? AND basket_id = ?`, [reporter, basket]);
  const tot = totQ.data ?? [];
  if (!m || tot.length === 0) return null;
  const obs = tot.filter((d) => d.kind === "observed");
  const now = tot.filter((d) => d.kind === "nowcast");
  const lastObs = obs.at(-1)!;
  const [y1, y2] = m.nowcast_years;
  const n1 = now.find((d) => d.year === y1), n2 = now.find((d) => d.year === y2);
  const bridge = [{ ...lastObs, kind: "nowcast" as const }, ...now]; // dashed line starts at the last observed year
  const sup = supQ.data ?? [];
  const top = [...new Set(sup.filter((d) => d.year === y1).sort((a, b) => b.share - a.share).slice(0, 8).map((d) => d.partner_iso3))];
  const shareOf = (iso: string, y: number) => sup.find((d) => d.partner_iso3 === iso && d.year === y)?.share ?? null;
  const baciShare = (iso: string) => sup.find((d) => d.partner_iso3 === iso)?.baci_share ?? null;
  const bt = m.backtest.metrics;
  const fmtE = (x: number) => pct(x, 1);
  return (
    <Section
      title={`Nowcast: annual imports on the BACI basis, ${y1}–${y2}`}
      description={`BACI, the reconciled annual data behind the other pages, stops at ${m.baci_last_year}. This estimates what it will show for ${y1} and ${y2}, from the monthly Eurostat data above: values converted to US dollars month by month, then adjusted by a model that learned how Eurostat and BACI differ for each importer, supplier and basket. ${y2} uses January–${monthFmt(new Date(Date.UTC(y2, m.comext_last_month - 1))).split(" ")[0]} scaled up by the usual seasonal pattern.`}
      note={<>Backtest on {m.backtest.test_years[0]}–{m.backtest.test_years[1]}, nowcasting each year before BACI was used: typical error of the yearly total {fmtE(bt.full_lag1.learned.median_abs_error)} for a complete year (Eurostat at the exchange rate alone: {fmtE(bt.full_lag1.fx_only.median_abs_error)}), {fmtE(bt.partial_lag2.learned.median_abs_error)} for a part-year scaled up ({fmtE(bt.partial_lag2.fx_only.median_abs_error)}). Largest-supplier share off by {bt.full_lag1.learned.top_supplier_share_mae_pp.toFixed(1)} points on average. Band: 10th–90th percentile of past errors. {m.caveats.join(" ")} Exchange rates: Eurostat (ert_bil_eur_m), based on ECB euro reference rates.</>}
    >
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="border-[var(--tg-observed)] text-[var(--tg-observed)]">Observed: CEPII BACI to {m.baci_last_year} ({m.baci_last_year} provisional)</Badge>
        <Badge variant="outline" style={{ borderColor: NOW, color: NOW }}>Nowcast: model estimate, {y1}–{y2}</Badge>
        <Badge variant="outline">EU importers only</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={`${reporterLabel}, ${y1} (nowcast)`} value={usd(n1?.value_kusd)} accent={NOW}
          context={n1 ? `${n1.value_kusd >= lastObs.value_kusd ? "+" : ""}${pct(n1.value_kusd / lastObs.value_kusd - 1)} vs ${lastObs.year}; range ${usd(n1.lo_kusd)} – ${usd(n1.hi_kusd)}` : "–"} />
        <Stat label={`${y2}, full-year estimate (nowcast)`} value={usd(n2?.value_kusd)} accent={NOW}
          context={n2 ? `From ${n2.months} months of data; range ${usd(n2.lo_kusd)} – ${usd(n2.hi_kusd)}` : "–"} />
        <Stat label={`Largest supplier, ${y1} (nowcast)`} value={top[0] ? pct(shareOf(top[0], y1)) : "–"} accent={top[0] ? colorOf(top[0]) : undefined}
          context={top[0] ? <span className="flex items-center gap-1.5"><Swatch color={colorOf(top[0])} />{nameOf(top[0])}, {pct(baciShare(top[0]))} in {m.baci_last_year} (BACI)</span> : "–"} />
      </div>
      <div className="grid gap-10 [&>*]:min-w-0 lg:grid-cols-[3fr_2fr]">
        <PlotFigure
          deps={[tot]}
          label={`${reporterLabel} imports of ${basketLabel}, ${obs[0]?.year}–${y2}: observed BACI values and nowcast.`}
          make={(width) => ({
            width, height: 280, marginLeft: 64,
            x: { label: null, tickFormat: "d", ticks: 8 },
            y: { label: "↑ Imports, current USD (BACI basis)", tickFormat: (d: number) => usd(d), grid: true, zero: true },
            marks: [
              Plot.areaY(now, { x: "year", y1: "lo_kusd", y2: "hi_kusd", fill: NOW, fillOpacity: 0.16 }),
              Plot.lineY(obs, { x: "year", y: "value_kusd", stroke: OBSERVED, strokeWidth: 2 }),
              Plot.dot(obs, { x: "year", y: "value_kusd", r: 3, fill: (d: NowTotal) => (d.provisional ? INK : OBSERVED), stroke: OBSERVED }),
              Plot.lineY(bridge, { x: "year", y: "value_kusd", stroke: NOW, strokeWidth: 2, strokeDasharray: "5,4" }),
              Plot.dot(now, { x: "year", y: "value_kusd", r: 4, fill: INK, stroke: NOW, strokeWidth: 2 }),
              Plot.tip(tot, Plot.pointerX({ x: "year", y: "value_kusd", ...TIP,
                title: (d: NowTotal) => d.kind === "nowcast" ? `${d.year}, nowcast\n${usd(d.value_kusd)} (range ${usd(d.lo_kusd)} – ${usd(d.hi_kusd)})` : `${d.year}, observed (BACI${d.provisional ? ", provisional" : ""})\n${usd(d.value_kusd)}` })),
            ],
          })}
        />
        <div className="space-y-2">
          <Legend items={[{ label: "Observed (BACI)", color: OBSERVED }, { label: "Nowcast, with 10–90% band", color: NOW }]} />
          <p className="text-xs text-muted-foreground">Supplier shares. * nowcast.</p>
          <DataTable
            rows={top}
            rowKey={(d) => d}
            columns={[
              { key: "s", label: "Supplier", render: (d: string) => <span className="flex items-center gap-2"><Swatch color={colorOf(d)} />{nameOf(d)}</span> },
              { key: "b", label: `${m.baci_last_year} BACI`, numeric: true, render: (d: string) => pct(baciShare(d)) },
              { key: "n1", label: `${y1}*`, numeric: true, render: (d: string) => pct(shareOf(d, y1)) },
              { key: "n2", label: `${y2}*`, numeric: true, render: (d: string) => pct(shareOf(d, y2)) },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}

// ML F (EU scope): how extra-EU imports crossed the EU border (Eurostat, mode of transport by HS6). Observed.
const MODE_ORDER = ["sea", "air", "road", "rail", "other"] as const;
const MODE_TEXT: Record<string, string> = { sea: "Sea", air: "Air", road: "Road", rail: "Rail", other: "Other or unknown" };
const MODE_COLOR: Record<string, string> = { sea: "#38c4e8", air: "#c9a7ff", road: "#d98b5f", rail: "#8ad17a", other: "#6b7a84" };
// Why months are missing at the end: the check runs on the importer's records across ALL baskets, so say so.
function HeldBack({ months, reporterLabel, threshold }: { months: Incomplete[]; reporterLabel: string; threshold: number }) {
  const why = (d: Incomplete) =>
    [
      d.intra_eu_records_vs_usual != null && d.intra_eu_records_vs_usual < threshold && `trade with other EU countries at ${pct(d.intra_eu_records_vs_usual, 0)}`,
      d.extra_eu_records_vs_usual != null && d.extra_eu_records_vs_usual < threshold && `trade with countries outside the EU at ${pct(d.extra_eu_records_vs_usual, 0)}`,
    ].filter(Boolean).join(" and ");
  return (
    <p className="max-w-3xl text-sm text-muted-foreground">
      Not shown yet: {months.map((d) => `${monthFmt(new Date(`${d.month}-01`))}${why(d) ? ` (${why(d)} of a usual month's records)` : ""}`).join("; ")}.
      Eurostat's latest release covers only part of {months.length > 1 ? "these months" : "this month"} for {reporterLabel}, across all baskets.
      {months.length > 1 ? " They appear" : " It appears"} once Eurostat completes the data.
    </p>
  );
}

const ISO3_OF: Record<string, string> = { DE: "DEU", FR: "FRA", IT: "ITA", NL: "NLD", ES: "ESP", PL: "POL", EU27_2020_EXTRA: "EU27_2020_EXTRA" };
type ModeRow = { year: number; months: number; partner_iso3: string; mode: string; value_eur: number; kg: number | null };

function ArrivalSection({ reporter, reporterLabel, basket, basketLabel, nameOf, colorOf }: {
  reporter: string; reporterLabel: string; basket: string; basketLabel: string;
  nameOf: (iso3: string | null | undefined) => string; colorOf: (iso3: string) => string;
}) {
  const [basis, setBasis] = useState<"value" | "weight">("value");
  const q = useQuery<ModeRow>(`SELECT year, months, partner_iso3, mode, value_eur, kg FROM transport_mode WHERE reporter = ? AND basket_id = ?`, [ISO3_OF[reporter] ?? reporter, basket]);
  const rows = q.data ?? [];
  const amt = (d: ModeRow) => (basis === "value" ? d.value_eur : d.kg ?? 0);
  const byYear = useMemo(() => {
    const m = new Map<string, { year: number; months: number; mode: string; v: number }>();
    for (const d of rows) {
      const k = `${d.year}|${d.mode}`;
      const r = m.get(k) ?? { year: d.year, months: d.months, mode: d.mode, v: 0 };
      r.v += amt(d);
      m.set(k, r);
    }
    const tot = new Map<number, number>();
    for (const r of m.values()) tot.set(r.year, (tot.get(r.year) ?? 0) + r.v);
    return [...m.values()].map((r) => ({ ...r, share: r.v / (tot.get(r.year) || 1), label: r.months < 12 ? `${r.year}*` : String(r.year) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, basis]);
  if (rows.length === 0) return null;
  const lastFull = Math.max(...rows.filter((d) => d.months === 12).map((d) => d.year));
  // Every row of a year carries that year's coverage (months loaded), so any row of the latest part-year will do.
  const partialYear = Math.max(...rows.map((d) => d.year));
  const partial = rows.find((d) => d.year === partialYear && d.months < 12);
  const partialSpan = partial ? (partial.months === 1 ? "January" : `January–${MONTH_NAME(partial.months)}`) : "";
  const latest = rows.filter((d) => d.year === lastFull);
  const partners = [...new Set(latest.map((d) => d.partner_iso3))]
    .map((p) => {
      const pr = latest.filter((d) => d.partner_iso3 === p);
      const total = pr.reduce((s, d) => s + amt(d), 0);
      const share = Object.fromEntries(MODE_ORDER.map((mo) => [mo, pr.filter((d) => d.mode === mo).reduce((s, d) => s + amt(d), 0) / (total || 1)]));
      return { p, total, share };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  const yLabels = [...new Set(byYear.map((d) => d.label))].sort();
  const seaNow = byYear.filter((d) => d.year === lastFull && d.mode === "sea").reduce((s, d) => s + d.share, 0);
  const airNow = byYear.filter((d) => d.year === lastFull && d.mode === "air").reduce((s, d) => s + d.share, 0);
  return (
    <Section
      title="How these imports arrive"
      description={`Share of ${ownerOf(reporter)} ${basketLabel.toLowerCase()} imports from outside the EU by how they crossed the EU border, ${basis === "value" ? "by value" : "by weight"}. In ${lastFull}: ${pct(seaNow, 0)} by sea, ${pct(airNow, 0)} by air. The Sea routes page uses these observed sea shares for EU importers.`}
      note={<>Observed: Eurostat, extra-EU trade by mode of transport (HS6), mode at the EU's external border. Goods that reach one member state by sea and travel on by road count as sea; goods shipped to a non-EU neighbour (e.g. Türkiye, or the United Kingdom from 2020) and trucked into the EU count as road. Postal consignments are counted as air, inland waterways as sea. {partial ? `${partial.year}* covers ${partialSpan} only. ` : ""}The United Kingdom left the EU in 2020; before that its trade with member states was trade within the EU and is not in these figures. Source: Eurostat (Comext), © European Union; adapted by TradeGraph AI, and Eurostat is not responsible for the adapted figures.</>}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Legend items={MODE_ORDER.map((mo) => ({ label: MODE_TEXT[mo], color: MODE_COLOR[mo] }))} />
        <ToggleGroup value={[basis]} onValueChange={(v) => v[0] && setBasis(v[0] as "value" | "weight")} aria-label="Measure">
          <ToggleGroupItem value="value">By value</ToggleGroupItem>
          <ToggleGroupItem value="weight">By weight</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid gap-10 [&>*]:min-w-0 lg:grid-cols-[3fr_2fr]">
        <PlotFigure
          deps={[byYear]}
          label={`Share of ${reporterLabel} imports of ${basketLabel} by transport mode and year.`}
          make={(width) => ({
            width, height: 280, marginLeft: 44,
            x: { label: null, domain: yLabels, tickRotate: yLabels.length > 10 ? -45 : 0 },
            y: { label: "↑ Share of imports", tickFormat: "%", domain: [0, 1] },
            color: { domain: [...MODE_ORDER], range: MODE_ORDER.map((mo) => MODE_COLOR[mo]) },
            marks: [
              Plot.barY(byYear, Plot.stackY({ x: "label", y: "share", fill: "mode", order: [...MODE_ORDER], inset: 0.5 })),
              Plot.tip(byYear, Plot.pointer(Plot.stackY({ x: "label", y: "share", z: "mode", order: [...MODE_ORDER], ...TIP,
                title: (d: (typeof byYear)[number]) => `${d.label}: ${MODE_TEXT[d.mode]} ${pct(d.share)}` }))),
            ],
          })}
        />
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Largest partners in {lastFull}, share by mode ({basis}).</p>
          <DataTable
            rows={partners}
            rowKey={(d) => d.p}
            columns={[
              { key: "p", label: "Partner", render: (d) => <span className="flex items-center gap-2"><Swatch color={colorOf(d.p)} />{nameOf(d.p)}</span> },
              ...MODE_ORDER.slice(0, 4).map((mo) => ({ key: mo, label: MODE_TEXT[mo], numeric: true, render: (d: (typeof partners)[number]) => pct(d.share[mo], 0) })),
            ]}
          />
        </div>
      </div>
    </Section>
  );
}
