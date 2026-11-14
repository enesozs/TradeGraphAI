import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BasketSelect, CountryPicker, YearSlider } from "@/components/controls";
import { Page, Section, Stat, Swatch } from "@/components/page";
import { PlotFigure, TIP } from "@/components/plot-figure";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useQuery } from "@/lib/db";
import { countryName, pct, tonnes, usd } from "@/lib/format";
import { latestFinalYear, useBuildInfo } from "@/lib/meta";
import {
  ControlBar, CsvLink, DataTable, INK, distinctColors, Legend, Loading, Notice, OBSERVED, OBSERVED_LIGHT, OTHERS, SCENARIO, TEAL, fmt0, useColorOf, type Column,
} from "./profile-page-kit";

type ImpRow = {
  basket_id: string; year: number; imports_kusd: number; imports_t: number | null; supplier_count: number; hhi_value: number;
  effective_suppliers: number; hhi_tonnes: number | null; top1_share_value: number; top3_share_value: number; tonnes_coverage: number | null;
  importer_iso3: string; importer_name: string; top1_supplier_iso3: string; top1_supplier_name: string; is_provisional: boolean;
};
type SupRow = {
  year: number; supplier_iso3: string; supplier_name: string; value_kusd: number; quantity_t: number | null; share_value: number;
  share_tonnes: number | null; rank_value: number; redirectable_kusd: number;
};
type Basis = "value" | "tonnes";

const evenYears = (years: number[]) => years.filter((y) => y % 2 === 0);

export function ProfilePage() {
  const info = useBuildInfo();
  const colorOf = useColorOf();
  const [params, setParams] = useSearchParams();
  const [year, setYear] = useState<number | null>(null);
  const [basisRaw, setBasis] = useState<Basis>("value");
  const [shockedIso, setShockedIso] = useState<string | null>(null);
  const [shortfall, setShortfall] = useState(0.4);

  useEffect(() => {
    if (info && year == null) setYear(latestFinalYear(info));
  }, [info, year]);

  const basketParam = params.get("basket");
  const basket = info?.baskets.find((b) => b.id === basketParam) ?? info?.baskets[0] ?? null;
  const basketId = basket?.id ?? "";
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };

  const importers = useQuery<{ iso3: string; name: string; mx: number }>(
    `SELECT importer_iso3 AS iso3, any_value(importer_name) AS name, max(imports_kusd) AS mx
     FROM importer_basket_year WHERE basket_id = ? GROUP BY 1 ORDER BY mx DESC`, [basketId]);
  const importerList = importers.data ?? [];
  const countryParam = params.get("country") ?? "DEU";
  const importer = importerList.find((d) => d.iso3 === countryParam) ?? importerList.find((d) => d.iso3 === "DEU") ?? importerList[0] ?? null;
  const iso = importer?.iso3 ?? "";
  const importerLabel = countryName(iso, importer?.name);
  const pickerNames = useMemo(() => new Map(importerList.map((d) => [d.iso3, `${countryName(d.iso3, d.name)} (${d.iso3})`])), [importerList]);

  const seriesQ = useQuery<ImpRow>(`SELECT * FROM importer_basket_year WHERE basket_id = ? AND importer_iso3 = ? ORDER BY year`, [basketId, iso]);
  const suppliersQ = useQuery<SupRow>(
    `SELECT * FROM supplier_basket_year WHERE basket_id = ? AND importer_iso3 = ? AND year = ? ORDER BY rank_value`, [basketId, iso, year ?? 0]);
  const mixQ = useQuery<Pick<SupRow, "year" | "supplier_iso3" | "supplier_name" | "value_kusd" | "quantity_t">>(
    `SELECT year, supplier_iso3, supplier_name, value_kusd, quantity_t FROM supplier_basket_year WHERE basket_id = ? AND importer_iso3 = ?`, [basketId, iso]);

  const series = seriesQ.data ?? [];
  const suppliers = suppliersQ.data ?? [];
  const cur = series.find((d) => d.year === year);
  const valueOnly = !!basket?.value_only;
  const basis: Basis = valueOnly ? "value" : basisRaw;
  const useT = basis === "tonnes";
  const years = info?.years ?? [];

  // ---- supplier share bars: top 10 + all others ----
  const shareKey = useT ? "share_tonnes" : "share_value";
  const bars = useMemo(() => {
    const ranked = suppliers.filter((d) => d[shareKey] != null).sort((a, b) => (b[shareKey] ?? 0) - (a[shareKey] ?? 0));
    const top = ranked.slice(0, 10).map((d) => ({
      iso3: d.supplier_iso3, label: countryName(d.supplier_iso3, d.supplier_name), share: d[shareKey] as number,
      amount: useT ? tonnes(d.quantity_t) : usd(d.value_kusd), color: colorOf(d.supplier_iso3),
    }));
    const rest = ranked.slice(10);
    if (rest.length) {
      top.push({
        iso3: "", label: `All others (${rest.length})`, share: rest.reduce((s, d) => s + (d[shareKey] ?? 0), 0),
        amount: useT ? tonnes(rest.reduce((s, d) => s + (d.quantity_t ?? 0), 0)) : usd(rest.reduce((s, d) => s + d.value_kusd, 0)), color: OTHERS,
      });
    }
    const cols = distinctColors(top.map((d) => d.color));
    return top.map((d, i) => ({ ...d, color: cols[i] }));
  }, [suppliers, shareKey, useT, colorOf]);

  // ---- concentration over time ----
  const metrics = useMemo(() => {
    const m = [
      { key: "HHI (value)", color: OBSERVED, dashed: false },
      ...(valueOnly ? [] : [{ key: "HHI (tonnes)", color: OBSERVED_LIGHT, dashed: true }]),
      { key: "Largest supplier share (value)", color: TEAL, dashed: false },
    ];
    return m;
  }, [valueOnly]);
  const long = useMemo(() => series.flatMap((d) => [
    { year: d.year, metric: "HHI (value)", v: d.hhi_value, prov: d.is_provisional },
    { year: d.year, metric: "Largest supplier share (value)", v: d.top1_share_value, prov: d.is_provisional, who: countryName(d.top1_supplier_iso3, d.top1_supplier_name) },
    ...(valueOnly || d.hhi_tonnes == null ? [] : [{ year: d.year, metric: "HHI (tonnes)", v: d.hhi_tonnes, prov: d.is_provisional }]),
  ]), [series, valueOnly]);

  // ---- supplier mix over time: five largest suppliers over the period + others ----
  const mix = useMemo(() => {
    const raw = mixQ.data ?? [];
    const amt = (d: (typeof raw)[number]) => (useT ? d.quantity_t ?? 0 : d.value_kusd);
    const totals = new Map<string, number>();
    const nameOf = new Map<string, string>();
    for (const d of raw) {
      totals.set(d.supplier_iso3, (totals.get(d.supplier_iso3) ?? 0) + amt(d));
      nameOf.set(d.supplier_iso3, countryName(d.supplier_iso3, d.supplier_name));
    }
    const top5 = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
    const byYear = new Map<number, Map<string, number>>();
    const yearTotal = new Map<number, number>();
    for (const d of raw) {
      const k = top5.includes(d.supplier_iso3) ? d.supplier_iso3 : "OTHERS";
      const m = byYear.get(d.year) ?? new Map<string, number>();
      m.set(k, (m.get(k) ?? 0) + amt(d));
      byYear.set(d.year, m);
      yearTotal.set(d.year, (yearTotal.get(d.year) ?? 0) + amt(d));
    }
    const label = (k: string) => (k === "OTHERS" ? "All others" : nameOf.get(k) ?? k);
    const order = [...top5, "OTHERS"];
    const rows = [...byYear.entries()].flatMap(([y, m]) =>
      order.map((k) => ({ year: y, key: k, supplier: label(k), v: m.get(k) ?? 0, share: (yearTotal.get(y) ?? 0) > 0 ? (m.get(k) ?? 0) / yearTotal.get(y)! : 0 })),
    ).sort((a, b) => a.year - b.year);
    const cols = distinctColors(order.map((k) => (k === "OTHERS" ? OTHERS : colorOf(k))));
    const legend = order.map((k, i) => ({ key: k, label: label(k), color: cols[i] }));
    return { rows, legend };
  }, [mixQ.data, useT, colorOf]);

  // ---- exposure scenario (mirrors tradegraph.scenarios.exposure.direct_exposure, tests/test_exposure.py) ----
  const options = useMemo(() => suppliers.map((d) => ({ iso3: d.supplier_iso3, label: countryName(d.supplier_iso3, d.supplier_name), value: d.value_kusd, R: d.redirectable_kusd ?? 0 })), [suppliers]);
  useEffect(() => {
    if (options.length && !options.some((o) => o.iso3 === shockedIso)) setShockedIso(options[0].iso3);
  }, [options, shockedIso]);
  const shocked = options.find((o) => o.iso3 === shockedIso) ?? null;
  const scen = useMemo(() => {
    if (!shocked) return null;
    const imports = options.reduce((s, d) => s + d.value, 0);
    const exposed = shocked.value * shortfall;
    const alts = options.filter((d) => d.iso3 !== shocked.iso3).sort((a, b) => b.R - a.R);
    const totalR = alts.reduce((s, d) => s + d.R, 0);
    return { imports, exposed, share: imports ? exposed / imports : 0, alts, totalR, coverage: exposed ? totalR / exposed : null };
  }, [options, shocked, shortfall]);

  // ---- tables ----
  const supCols: Column<SupRow>[] = [
    { key: "rank", label: "Rank", numeric: true, render: (d) => d.rank_value, csv: (d) => d.rank_value },
    { key: "sup", label: "Supplier", render: (d) => <span className="flex items-center gap-2"><Swatch color={colorOf(d.supplier_iso3)} />{countryName(d.supplier_iso3, d.supplier_name)}</span>, csv: (d) => countryName(d.supplier_iso3, d.supplier_name) },
    { key: "iso", label: "ISO3", render: (d) => <span className="text-muted-foreground">{d.supplier_iso3}</span>, csv: (d) => d.supplier_iso3 },
    { key: "v", label: "Value (k USD)", numeric: true, render: (d) => fmt0(d.value_kusd), csv: (d) => d.value_kusd },
    { key: "sv", label: "Share (value)", numeric: true, render: (d) => pct(d.share_value), csv: (d) => d.share_value },
    ...(valueOnly ? [] : [
      { key: "t", label: "Tonnes", numeric: true, render: (d: SupRow) => fmt0(d.quantity_t), csv: (d: SupRow) => d.quantity_t },
      { key: "st", label: "Share (tonnes)", numeric: true, render: (d: SupRow) => pct(d.share_tonnes), csv: (d: SupRow) => d.share_tonnes },
    ]),
    { key: "r", label: "Redirectable (k USD)", numeric: true, render: (d) => fmt0(d.redirectable_kusd), csv: (d) => d.redirectable_kusd },
  ];
  type Alt = (typeof options)[number];
  const altCols: Column<Alt>[] = [
    { key: "sup", label: "Supplier", render: (d) => <span className="flex items-center gap-2"><Swatch color={colorOf(d.iso3)} />{d.label}</span> },
    { key: "iso", label: "ISO3", render: (d) => <span className="text-muted-foreground">{d.iso3}</span> },
    { key: "v", label: "Already supplies (k USD)", numeric: true, render: (d) => fmt0(d.value) },
    { key: "r", label: "Redirectable (k USD)", numeric: true, render: (d) => fmt0(d.R) },
    { key: "ratio", label: "Redirectable ÷ exposed", numeric: true, render: (d) => (scen?.exposed ? (d.R / scen.exposed >= 100 ? ">100×" : `${(d.R / scen.exposed).toFixed(2)}×`) : "–") },
  ];

  const top1Label = cur ? countryName(cur.top1_supplier_iso3, cur.top1_supplier_name) : "–";
  const hhiCur = cur ? (useT ? cur.hhi_tonnes : cur.hhi_value) : null;
  const loading = !info || importers.loading;

  return (
    <Page
      title="Dependency profile"
      lead={basket && importer
        ? <>Who supplies {importerLabel} with {basket.label.toLowerCase()}, how concentrated that supply is, and how it changed from {years[0]} to {years.at(-1)}.</>
        : "Who supplies a country with a product, and how concentrated that supply is."}
      meta={info && (
        <>
          <Badge variant="outline" className="border-[var(--tg-observed)] text-[var(--tg-observed)]">Observed</Badge>
          <Badge variant="outline">CEPII BACI {info.source.hs_revision}, release {info.source.release}</Badge>
          <Badge variant="outline">Value in thousand current USD (FOB-reconciled)</Badge>
          <Badge variant="outline">Denominator: imports from all partner countries</Badge>
        </>
      )}
    >
      <ControlBar>
          <BasketSelect info={info} value={basketId} onChange={(v) => setParam("basket", v)} className="w-60" />
          <CountryPicker options={importerList.map((d) => d.iso3)} names={pickerNames} value={iso} onChange={(v) => setParam("country", v)} label="Importer" className="w-60" />
          <YearSlider info={info} value={year} onChange={setYear} className="w-48" />
          <div className="space-y-1.5">
            <Label>Basis</Label>
            <ToggleGroup value={[basis]} onValueChange={(v) => v[0] && setBasis(v[0] as Basis)} aria-label="Basis">
              <ToggleGroupItem value="value">Value</ToggleGroupItem>
              <ToggleGroupItem value="tonnes" disabled={valueOnly} title={valueOnly ? "This basket is value-only: quantities are not comparable across its codes" : undefined}>Tonnes</ToggleGroupItem>
            </ToggleGroup>
          </div>
      </ControlBar>
      {loading ? <Loading /> : (
        <>
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground">{importerLabel}, {basket?.label}, {year}</h2>
            {!cur && !seriesQ.loading && (
              <Notice>No recorded imports of this basket for {importerLabel} in {year}. Missing flows are <em>not recorded</em>, which is not the same as zero.</Notice>
            )}
            {cur?.is_provisional && (
              <Notice tone="warning"><strong>Provisional year.</strong> CEPII warns that values for the latest year in a release ({year}) may be substantially revised.</Notice>
            )}
            {useT && cur && cur.tonnes_coverage != null && cur.tonnes_coverage < 0.9 && (
              <Notice tone="warning">Quantities are recorded for only {pct(cur.tonnes_coverage)} of this import value, so the tonnes view is partial.</Notice>
            )}
            {cur && !valueOnly && cur.hhi_tonnes != null && Math.abs(cur.hhi_value - cur.hhi_tonnes) > 0.1 && (
              <Notice tone="warning">
                <strong>Price check:</strong> concentration by value (HHI {cur.hhi_value.toFixed(2)}) and by tonnes (HHI {cur.hhi_tonnes.toFixed(2)}) differ a lot. Unit prices vary across suppliers, so compare both views before drawing conclusions.
              </Notice>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={`Total imports, ${year}`} value={useT ? tonnes(cur?.imports_t) : usd(cur?.imports_kusd)} context={useT ? "Recorded quantity, metric tonnes" : "From all partner countries, current USD"} />
              <Stat label="Suppliers" value={cur?.supplier_count ?? "–"} context={<>Effective suppliers {cur ? cur.effective_suppliers.toFixed(1) : "–"} (1 / HHI by value)</>} />
              <Stat label={`Concentration (HHI, ${useT ? "tonnes" : "value"})`} value={hhiCur != null ? hhiCur.toFixed(2) : "–"} context="Near 0 is dispersed, 1 is a single supplier" />
              <Stat
                label="Largest supplier, by value"
                value={cur ? pct(cur.top1_share_value) : "–"}
                accent={cur ? colorOf(cur.top1_supplier_iso3) : undefined}
                context={cur ? <span className="flex items-center gap-1.5"><Swatch color={colorOf(cur.top1_supplier_iso3)} />{top1Label}, top 3 together {pct(cur.top3_share_value)}</span> : "–"}
              />
            </div>
          </div>

          <div className="grid gap-10 lg:grid-cols-2">
            <Section
              title={`Supplier shares, ${year}`}
              description={`Share of ${importerLabel}'s ${useT ? "recorded tonnes" : "import value"} from each supplier. Ten largest, then all others.`}
              note={`Denominator: ${useT ? "recorded tonnes" : "import value"} from all ${cur?.supplier_count ?? "recorded"} partner countries.`}
            >
              {bars.length ? (
                <PlotFigure
                  label={`Supplier shares of ${importerLabel}'s imports, ${year}`}
                  deps={[bars]}
                  make={(width) => {
                    const ml = Math.min(180, Math.max(110, width * 0.36));
                    const trunc = (s: string) => (s.length * 6.4 > ml - 10 ? s.slice(0, Math.floor((ml - 10) / 6.4) - 1) + "…" : s);
                    return {
                      width, height: 26 * bars.length + 36, marginLeft: ml, marginRight: 52,
                      x: { label: null, tickFormat: "%", domain: [0, Math.max(0.05, ...bars.map((d) => d.share))], grid: true, ticks: 4 },
                      y: { label: null, domain: bars.map((d) => d.label), tickFormat: trunc, tickSize: 0 },
                      color: { type: "identity" },
                      grid: false,
                      marks: [
                        Plot.gridX({ stroke: "currentColor", strokeOpacity: 0.08, ticks: 4 }),
                        Plot.barX(bars, { x: "share", y: "label", fill: "color", fillOpacity: 0.9, insetTop: 4, insetBottom: 4 }),
                        Plot.text(bars, { x: "share", y: "label", text: (d) => pct(d.share), dx: 5, textAnchor: "start", fill: "var(--tg-paper)" }),
                        Plot.tip(bars, Plot.pointerY({ x: "share", y: "label", ...TIP, title: (d) => `${d.label}\n${pct(d.share)} of ${useT ? "tonnes" : "value"}\n${d.amount}` })),
                      ],
                    };
                  }}
                />
              ) : <p className="text-sm text-muted-foreground">No recorded suppliers for this selection.</p>}
            </Section>

            <Section
              title="Concentration over time"
              description={<>HHI and largest-supplier share by year. {valueOnly ? "" : "Dashed line is HHI by tonnes. "}Hollow points are provisional. The vertical rule marks {year}.</>}
              note="HHI is the sum of squared supplier shares over all partners. Lines connect yearly observations; nothing in between is measured."
            >
              <Legend items={[...metrics.map((m) => ({ label: m.key, color: m.color, dashed: m.dashed })), { label: "Provisional year", color: "var(--tg-haze)", hollow: true }]} />
              <PlotFigure
                label={`Concentration of ${importerLabel}'s imports over time`}
                deps={[long, metrics, year, years]}
                make={(width) => ({
                  width, height: 280, marginRight: 16, marginLeft: 36,
                  x: { label: null, tickFormat: "d", domain: [years[0], years.at(-1)], ticks: evenYears(years) },
                  y: { label: "Index or share", domain: [0, 1], grid: true, ticks: 5 },
                  color: { domain: metrics.map((m) => m.key), range: metrics.map((m) => m.color) },
                  marks: [
                    Plot.ruleX([year], { stroke: "currentColor", strokeOpacity: 0.35, strokeDasharray: "2,3" }),
                    ...metrics.map((m) => Plot.lineY(long.filter((d) => d.metric === m.key), { x: "year", y: "v", stroke: m.color, strokeWidth: 1.5, strokeDasharray: m.dashed ? "4,3" : undefined })),
                    Plot.dot(long, { x: "year", y: "v", stroke: "metric", fill: (d) => (d.prov ? INK : d.metric), r: 2.5, strokeWidth: 1.5 }),
                    Plot.tip(long, Plot.pointer({
                      x: "year", y: "v", ...TIP,
                      title: (d) => `${d.metric}, ${d.year}${d.prov ? " (provisional)" : ""}\n${d.metric.startsWith("HHI") ? d.v.toFixed(3) : pct(d.v)}${"who" in d && d.who ? `\nLargest: ${d.who}` : ""}`,
                    })),
                  ],
                })}
              />
            </Section>
          </div>

          <Section
            title="Supplier mix over time"
            description={`Share of ${importerLabel}'s ${useT ? "recorded tonnes" : "import value"} from the five largest suppliers over ${years[0]}–${years.at(-1)}, plus all others. Colours match the trade map.`}
            note="Shares are within each year's recorded total. A supplier with no row in a year has no recorded trade, which is not a confirmed zero."
          >
            <Legend items={mix.legend.map((l) => ({ label: l.label, color: l.color }))} />
            {mix.rows.length ? (
              <PlotFigure
                label={`Supplier mix of ${importerLabel}'s imports over time`}
                deps={[mix, year, years]}
                make={(width) => ({
                  width, height: 300, marginRight: 16, marginLeft: 40,
                  x: { label: null, tickFormat: "d", domain: [years[0], years.at(-1)], ticks: evenYears(years) },
                  y: { label: "Share", tickFormat: "%", grid: true, domain: [0, 1] },
                  color: { domain: mix.legend.map((l) => l.label), range: mix.legend.map((l) => l.color) },
                  marks: [
                    Plot.areaY(mix.rows, Plot.stackY({ order: mix.legend.map((l) => l.label) }, { x: "year", y: "share", fill: "supplier", fillOpacity: 0.85, stroke: INK, strokeWidth: 0.75 })),
                    Plot.ruleX([year], { stroke: "var(--tg-paper)", strokeOpacity: 0.5 }),
                    Plot.tip(mix.rows, Plot.pointer(Plot.stackY({ order: mix.legend.map((l) => l.label) }, {
                      x: "year", y: "share", z: "supplier", ...TIP,
                      title: (d: (typeof mix.rows)[number]) => `${d.supplier}, ${d.year}\n${pct(d.share)} (${useT ? tonnes(d.v) : usd(d.v)})`,
                    }))),
                  ],
                })}
              />
            ) : <p className="text-sm text-muted-foreground">No recorded imports for this selection.</p>}
          </Section>

          <section className="space-y-5 rounded-xl border p-5 sm:p-6" style={{ borderColor: "color-mix(in srgb, var(--tg-scenario) 40%, transparent)", background: "color-mix(in srgb, var(--tg-scenario) 4%, transparent)" }}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-[var(--tg-scenario)] text-[var(--tg-scenario)]">Scenario</Badge>
                  <h2 className="text-lg font-semibold text-foreground">Exposure scenario: what if one supplier fell short?</h2>
                </div>
                <p className="text-sm text-muted-foreground">Observed {year} data plus one stated assumption. This is not a forecast or a causal estimate. Values only (current USD).</p>
              </div>
            </div>
            {shocked && scen ? (
              <>
                <div className="flex flex-wrap items-end gap-6">
                  <div className="flex flex-col gap-1.5">
                    <Label>Supplier</Label>
                    <Select items={options.map((o) => ({ value: o.iso3, label: o.label }))} value={shocked.iso3} onValueChange={(v) => v && setShockedIso(v as string)}>
                      <SelectTrigger className="w-64" aria-label="Supplier that falls short"><SelectValue /></SelectTrigger>
                      <SelectPopup>{options.map((o) => <SelectItem key={o.iso3} value={o.iso3}>{o.label}</SelectItem>)}</SelectPopup>
                    </Select>
                  </div>
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between text-sm"><Label>Assumed shortfall</Label><span className="text-[var(--tg-scenario)]">{Math.round(shortfall * 100)}%</span></div>
                    <Slider aria-label="Assumed shortfall" min={0} max={1} step={0.05} value={shortfall} onValueChange={(v) => setShortfall(v as number)} />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Stat tone="scenario" label="Directly exposed imports (scenario)" value={usd(scen.exposed)} context={`${Math.round(shortfall * 100)}% of ${shocked.label}'s ${usd(shocked.value)}`} />
                  <Stat tone="scenario" label={`Share of ${importerLabel}'s imports (scenario)`} value={pct(scen.share)} context={`Of ${usd(scen.imports)} total, ${basket?.label}`} />
                  <Stat
                    label="Other suppliers' redirectable supply (observed)"
                    value={usd(scen.totalR)}
                    context={scen.coverage == null ? "No exposure at a 0% shortfall" : `${scen.coverage >= 100 ? ">100" : scen.coverage.toFixed(1)}× the exposed value (observed upper bound)`}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="relative h-3 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--tg-paper)_10%,transparent)]" role="img" aria-label={`Exposed ${pct(scen.share)} of total imports`}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, scen.share * 100)}%`, background: SCENARIO }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span><span className="text-[var(--tg-scenario)]">Exposed {pct(scen.share)}</span> of total imports</span>
                    <span>Total {usd(scen.imports)}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Alternative suppliers, ranked by redirectable supply</h3>
                  <DataTable columns={altCols} rows={scen.alts.slice(0, 15)} rowKey={(d) => d.iso3} maxHeight="22rem" />
                </div>
                <details className="text-sm text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">Assumption ledger</summary>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                    <li><strong className="text-foreground">Stated assumption:</strong> deliveries from {shocked.label} fall by {Math.round(shortfall * 100)}% for one year, using {year} values.</li>
                    <li><strong className="text-foreground">Observed:</strong> every other number comes from CEPII BACI {info?.source.hs_revision} release {info?.source.release}.</li>
                    <li><strong className="text-foreground">Redirectable supply</strong> is what each alternative supplier exported in this basket to all <em>other</em> countries in {year}. That's an upper bound: contracts, product mix within the basket, quality certification, logistics, policy and the supplier's own needs all limit how much could really be redirected.</li>
                    <li><strong className="text-foreground">Not modelled:</strong> price changes, stockpiles, demand response, new suppliers, or knock-on effects on other countries. No welfare or GDP effects are implied.</li>
                  </ol>
                </details>
              </>
            ) : <p className="text-sm text-muted-foreground">No recorded suppliers in {year}, so there is nothing to shock.</p>}
          </section>

          <Section
            title={`Suppliers, ${year}: data table`}
            description={<><strong className="text-foreground">Redirectable supply</strong> is what each supplier exported in this basket to every <em>other</em> country in {year}. It's an observed upper bound, not an estimate of how much could actually be redirected.</>}
          >
            <DataTable columns={supCols} rows={suppliers} rowKey={(d) => d.supplier_iso3} />
            <CsvLink columns={supCols} rows={suppliers} filename={`tradegraph_${basketId}_${iso}_${year}.csv`} />
          </Section>

          <p className="max-w-3xl text-sm text-muted-foreground">
            <strong className="text-foreground">How to read this.</strong> Shares use the importer's total imports from <strong>all</strong> partner countries. A country with no row has <em>no recorded</em> trade, which doesn't mean zero. Values are nominal USD and move with prices; where value and tonnes tell different stories, compare both. Lines and areas connect yearly observations; nothing in between is measured. "Other Asia, nes" is how BACI records Taiwan. Re-exports through trade hubs (e.g. Hong Kong, Singapore, the Netherlands) can make a hub look like a large supplier. Basket definition: {basket?.codes.join(", ")} ({info?.source.hs_revision}). {basket?.caveats?.length ? `Caveats: ${basket.caveats.join(" ")}` : ""} See <Link to="/methodology" className="text-primary underline-offset-4 hover:underline">Methodology</Link>.
          </p>
        </>
      )}
    </Page>
  );
}
