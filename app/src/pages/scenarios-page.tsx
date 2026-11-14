import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { BasketSelect } from "@/components/controls";
import { Page, Section, Stat, Swatch } from "@/components/page";
import { PlotFigure, TIP } from "@/components/plot-figure";
import { CardRow, PointerCard } from "@/components/pointer-card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useJson, useQuery } from "@/lib/db";
import { countryName, pct, usd } from "@/lib/format";
import { useCountryColors, type RGB } from "@/lib/country-colors";
import { useGeo, type Geo } from "@/lib/geo";
import { useBuildInfo } from "@/lib/meta";
import { DataTable, LineKey, PlotLegend, fmtInt, type Column } from "./network-page-table";

type Summary = {
  year: number; capacity: string; exposed_kusd: number; reallocated_kusd: number; unmet_kusd: number;
  n_importers: number; n_alternatives_used: number; mc_unmet_p5: number | null; mc_unmet_p50: number | null; mc_unmet_p95: number | null;
};
type Imp = {
  importer_iso3: string; imports_kusd: number; exposed_kusd: number; reallocated_kusd: number; unmet_kusd: number; unmet_share: number;
  unmet_share_p5: number | null; unmet_share_p50: number | null; unmet_share_p95: number | null;
};
type Flow = { alternative_iso3: string; importer_iso3: string; reallocated_kusd: number; existing_link: boolean };
type Capacity = "learned" | "low" | "central" | "high";

const SCEN = "#f3a712"; // --tg-scenario
const TEAL = "#2ec4b6"; // --tg-teal: reallocated supply
const UNMET = "#e4572e"; // --tg-warning: unmet demand
const BG = "#0e1519";
const SHORTFALLS = [0.25, 0.5, 0.75, 1.0];
const CAP_LABEL: Record<Capacity, string> = { learned: "Learned", low: "Low", central: "Central", high: "High" };
const CAP_ORDER: Capacity[] = ["learned", "low", "central", "high"];
const CAP_TEXT: Record<Capacity, string> = {
  learned: "each alternative supplier expands by what similar suppliers actually added the year after a rival's exports fell (learned from 2012–2024 history across all products); new links allowed at half priority",
  low: "5% of each alternative supplier's exports can be diverted; no new trade links",
  central: "15% can be diverted; new links allowed at half priority",
  high: "30% can be diverted; new links allowed at half priority",
};
const rgb = (c?: RGB) => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : "#6c7a80");

export function ScenariosPage() {
  const info = useBuildInfo();
  const geo = useGeo();
  const colors = useCountryColors();
  const [basket, setBasket] = useState("rare_earths_and_magnets");
  const [supplier, setSupplier] = useState<string | null>(null);
  const [shortfall, setShortfall] = useState(0.5);
  const [capacity, setCapacity] = useState<Capacity>("learned");
  const name = (c: string) => geo?.names.get(c) ?? countryName(c);
  const colorOf = (c: string) => rgb(colors?.get(c));

  const suppliersQ = useQuery<{ iso3: string; e: number }>(
    `SELECT supplier_iso3 AS iso3, any_value(exposed_kusd) AS e FROM scenario_summary WHERE basket_id = ? AND shortfall = 1.0 AND capacity = 'central' GROUP BY 1 ORDER BY e DESC`,
    [basket],
  );
  const suppliers = suppliersQ.data ?? [];
  useEffect(() => {
    if (suppliers.length && !suppliers.some((s) => s.iso3 === supplier)) setSupplier(suppliers[0].iso3);
  }, [suppliers, supplier]);
  const sup = supplier ?? "";

  const sumQ = useQuery<Summary>(`SELECT * FROM scenario_summary WHERE basket_id = ? AND supplier_iso3 = ? AND shortfall = ?`, [basket, sup, shortfall]);
  const impQ = useQuery<Imp>(
    `SELECT i.*, m.unmet_share_p5, m.unmet_share_p50, m.unmet_share_p95 FROM scenario_importer i
     LEFT JOIN scenario_mc_importer m ON m.basket_id = i.basket_id AND m.supplier_iso3 = i.supplier_iso3 AND m.shortfall = i.shortfall
       AND m.importer_iso3 = i.importer_iso3 AND m.method = ?
     WHERE i.basket_id = ? AND i.supplier_iso3 = ? AND i.shortfall = ? AND i.capacity = ? ORDER BY i.unmet_kusd DESC`,
    [capacity === "learned" ? "learned" : "assumed", basket, sup, shortfall, capacity],
  );
  const flowQ = useQuery<Flow>(
    `SELECT alternative_iso3, importer_iso3, reallocated_kusd, existing_link FROM scenario_flows WHERE basket_id = ? AND supplier_iso3 = ? AND shortfall = ? AND capacity = ? ORDER BY reallocated_kusd DESC LIMIT 30`,
    [basket, sup, shortfall, capacity],
  );
  const sum = sumQ.data ?? [];
  const S = sum.find((d) => d.capacity === capacity);
  const imp = impQ.data ?? [];
  const flows = flowQ.data ?? [];
  const hasMC = S?.mc_unmet_p5 != null;
  const learnedMC = capacity === "learned";
  const SC = sum.find((d) => d.capacity === "central");
  const SL = sum.find((d) => d.capacity === "learned");
  const mcText = learnedMC ? "5th–95th percentile over 100 correlated draws of the learned capacities" : "5th–95th percentile over 100 random capacity assumptions (5% to 30%)";
  const basketLabel = info?.baskets.find((b) => b.id === basket)?.label ?? basket;
  const supName = name(sup);
  const top = imp.slice(0, 15).map((d) => ({ ...d, label: name(d.importer_iso3) }));

  const wf = S
    ? [
        { step: "Exposed", start: 0, end: S.exposed_kusd },
        { step: "Reallocated", start: S.exposed_kusd - S.reallocated_kusd, end: S.exposed_kusd },
        { step: "Unmet", start: 0, end: S.unmet_kusd },
      ]
    : [];
  const sens = sum.map((d) => ({ capacity: CAP_LABEL[d.capacity as Capacity], unmet: d.unmet_kusd, selected: d.capacity === capacity }));
  const supplierItems = suppliers.map((s) => ({ value: s.iso3, label: name(s.iso3) }));

  const impCols: Column<Imp>[] = [
    { key: "n", label: "Importer", value: (d) => name(d.importer_iso3), render: (d) => <span className="inline-flex items-center gap-2"><Swatch color={colorOf(d.importer_iso3)} />{name(d.importer_iso3)}</span> },
    { key: "imp", label: "Imports, all partners (k USD)", value: (d) => d.imports_kusd, render: (d) => fmtInt(d.imports_kusd), numeric: true },
    { key: "e", label: "Exposed (k USD)", value: (d) => d.exposed_kusd, render: (d) => fmtInt(d.exposed_kusd), numeric: true },
    { key: "r", label: "Reallocated (k USD)", value: (d) => d.reallocated_kusd, render: (d) => fmtInt(d.reallocated_kusd), numeric: true },
    { key: "u", label: "Unmet (k USD)", value: (d) => d.unmet_kusd, render: (d) => fmtInt(d.unmet_kusd), numeric: true },
    { key: "s", label: "Unmet, % of imports", value: (d) => d.unmet_share, render: (d) => pct(d.unmet_share), numeric: true },
    { key: "rg", label: "Range p5–p95", value: (d) => d.unmet_share_p95, render: (d) => (d.unmet_share_p5 == null ? "–" : `${pct(d.unmet_share_p5)} – ${pct(d.unmet_share_p95)}`), numeric: true },
  ];
  const flowCols: Column<Flow>[] = [
    { key: "a", label: "Alternative supplier", value: (d) => name(d.alternative_iso3), render: (d) => <span className="inline-flex items-center gap-2"><Swatch color={colorOf(d.alternative_iso3)} />{name(d.alternative_iso3)}</span> },
    { key: "i", label: "Importer", value: (d) => name(d.importer_iso3), render: (d) => <span className="inline-flex items-center gap-2"><Swatch color={colorOf(d.importer_iso3)} />{name(d.importer_iso3)}</span> },
    { key: "v", label: "Reallocated (k USD)", value: (d) => d.reallocated_kusd, render: (d) => fmtInt(d.reallocated_kusd), numeric: true },
    { key: "l", label: "Link", value: (d) => (d.existing_link ? "Existing" : "New"), sortable: false },
  ];

  return (
    <Page
      wide
      title="What if a major supplier falls short?"
      lead="A scenario: one supplier delivers less of a product basket to every importer for one year. Other exporters can take up part of the gap under a stated capacity assumption; the rest is unmet demand. This is exposure arithmetic, not a forecast and not a price or welfare estimate."
      meta={
        <>
          <Badge variant="outline" className="border-[var(--tg-scenario)] text-[var(--tg-scenario)]">Scenario: assumed {shortfall * 100}% shortfall from {supName}</Badge>
          <Badge variant="outline">Capacity: {capacity === "learned" ? "learned from history (model)" : `${CAP_LABEL[capacity]} (assumed)`}</Badge>
          <Badge variant="outline">Base data observed: CEPII BACI {info?.source.hs_revision} V{info?.source.release}, {S?.year ?? "…"}</Badge>
        </>
      }
      actions={
        <>
          <BasketSelect info={info} value={basket} onChange={(v) => { setBasket(v); setSupplier(null); }} className="w-60" />
          <div className="space-y-1.5">
            <Label>Supplier that falls short</Label>
            <Select items={supplierItems} value={sup} onValueChange={(v) => v && setSupplier(v as string)}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectPopup>{supplierItems.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}</SelectPopup>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Assumed shortfall</Label>
            <ToggleGroup value={[String(shortfall)]} onValueChange={(v) => v[0] && setShortfall(Number(v[0]))} aria-label="Assumed shortfall">
              {SHORTFALLS.map((s) => <ToggleGroupItem key={s} value={String(s)}>{s * 100}%</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <Label>Alternative suppliers' capacity</Label>
            <ToggleGroup value={[capacity]} onValueChange={(v) => v[0] && setCapacity(v[0] as Capacity)} aria-label="Alternative suppliers' capacity">
              {CAP_ORDER.map((c) => <ToggleGroupItem key={c} value={c}>{c === "learned" ? "Learned" : `${CAP_LABEL[c]} (${c === "low" ? 5 : c === "central" ? 15 : 30}%)`}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
        </>
      }
    >
      <div className="grid gap-4 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-4">
        <Stat tone="scenario" label="Imports directly exposed" value={usd(S?.exposed_kusd)} context={`${S?.n_importers ?? "–"} importers buy ${basketLabel.toLowerCase()} from ${supName}; ${shortfall * 100}% of those purchases assumed lost`} />
        <Stat tone="scenario" accent={TEAL} label="Reallocated by other suppliers" value={usd(S?.reallocated_kusd)} context={`${S?.n_alternatives_used ?? "–"} alternative suppliers used`} />
        <Stat tone="scenario" accent={UNMET} label="Unmet demand" value={usd(S?.unmet_kusd)} context={S ? `${pct(S.unmet_kusd / S.exposed_kusd)} of the exposed value` : "–"} />
        <Stat
          tone="scenario"
          label="Unmet, uncertainty range"
          value={hasMC ? `${usd(S!.mc_unmet_p5)} – ${usd(S!.mc_unmet_p95)}` : "–"}
          context={hasMC ? mcText : "Uncertainty range computed only for 50% and 100% shortfalls"}
        />
      </div>

      <Section
        title="Lost supply and reallocated supply"
        description={`Countries shaded by unmet demand as a share of their ${basketLabel.toLowerCase()} imports from all partners. The 40 largest lost flows and the 30 largest reallocated flows are drawn. These are statistical links, not shipping routes.`}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <PlotLegend
            deps={[imp]}
            options={{
              color: { type: "sequential", interpolate: d3.interpolateRgb("#24343d", SCEN), domain: [0, Math.max(0.05, d3.max(imp, (d) => d.unmet_share) ?? 0)], label: "Unmet demand, share of the importer's imports (scenario)", tickFormat: "%" },
            }}
          />
          <LineKey color={SCEN} dash="6,4">Supply assumed lost</LineKey>
          <LineKey color={TEAL}>Reallocated, existing link</LineKey>
          <LineKey color={TEAL} dash="2,3">Reallocated, new link</LineKey>
        </div>
        <div className="overflow-hidden rounded-lg border bg-[var(--tg-ink)]">
          {geo ? (
            <ScenarioMap geo={geo} imp={imp} flows={flows} supplier={sup} name={name} label={`Scenario map: ${shortfall * 100}% shortfall of ${basketLabel} from ${supName}. Exact numbers in the tables below.`} />
          ) : (
            <p className="p-10 text-sm text-muted-foreground">Loading map…</p>
          )}
        </div>
      </Section>

      <div className="grid gap-10 [&>*]:min-w-0 lg:grid-cols-2">
        <Section title="Where the gap goes" description="Exposed imports split into what other suppliers reallocate and what stays unmet, under the selected capacity assumption.">
          <PlotFigure
            deps={[S]}
            label={`Scenario waterfall: exposed ${usd(S?.exposed_kusd)}, reallocated ${usd(S?.reallocated_kusd)}, unmet ${usd(S?.unmet_kusd)}.`}
            make={(width) => ({
              width, height: 260, marginLeft: 70,
              x: { label: null, domain: wf.map((d) => d.step), padding: 0.35 },
              y: { label: "↑ Value, current USD (scenario)", tickFormat: (d: number) => usd(d), grid: true },
              color: { domain: ["Exposed", "Reallocated", "Unmet"], range: [SCEN, TEAL, UNMET] },
              marks: [
                Plot.gridY({ strokeOpacity: 0.06 }),
                Plot.barY(wf, { x: "step", y1: "start", y2: "end", fill: "step", fillOpacity: 0.85 }),
                Plot.ruleY([0], { strokeOpacity: 0.3 }),
                Plot.tip(wf, Plot.pointerX({ x: "step", y: "end", ...TIP, title: (d: (typeof wf)[number]) => `${d.step}: ${usd(d.end - d.start)}` })),
              ],
            })}
          />
        </Section>
        <Section
          title="Capacity sensitivity"
          description="Unmet demand under each capacity assumption, same shortfall."
          note={SC?.mc_unmet_p5 != null ? "Grey bands: 5th–95th percentile of unmet demand. Learned: correlated draws of each supplier's learned expansion. Central: random fixed shares from 5% to 30%." : "No uncertainty range for this shortfall (computed for 50% and 100% only)."}
        >
          <PlotFigure
            deps={[sens, S, SC, SL]}
            label="Unmet demand under the learned capacity and the low, central and high capacity assumptions."
            make={(width) => ({
              width, height: 200, marginLeft: 70, marginRight: 30,
              x: { label: "Unmet demand, current USD (scenario) →", tickFormat: (d: number) => usd(d), grid: true },
              y: { label: null, domain: CAP_ORDER.map((c) => CAP_LABEL[c]) },
              marks: [
                Plot.gridX({ strokeOpacity: 0.06 }),
                SC?.mc_unmet_p5 != null ? Plot.ruleY(["Central"], { x1: SC.mc_unmet_p5, x2: SC.mc_unmet_p95!, stroke: "#93a8ba", strokeWidth: 12, strokeOpacity: 0.22 }) : null,
                SL?.mc_unmet_p5 != null ? Plot.ruleY(["Learned"], { x1: SL.mc_unmet_p5, x2: SL.mc_unmet_p95!, stroke: "#93a8ba", strokeWidth: 12, strokeOpacity: 0.22 }) : null,
                Plot.dot(sens, { x: "unmet", y: "capacity", r: 6, fill: (d: (typeof sens)[number]) => (d.selected ? UNMET : "#5d7286") }),
                Plot.tip(sens, Plot.pointerY({ x: "unmet", y: "capacity", ...TIP, title: (d: (typeof sens)[number]) => `${d.capacity} capacity: unmet ${usd(d.unmet)}` })),
              ],
            })}
          />
          <DataTable
            rows={sum.toSorted((a, b) => CAP_ORDER.indexOf(a.capacity as Capacity) - CAP_ORDER.indexOf(b.capacity as Capacity))}
            rowKey={(d) => d.capacity}
            maxHeight="none"
            caption="Capacity sensitivity"
            columns={[
              { key: "c", label: "Capacity", value: (d) => CAP_LABEL[d.capacity as Capacity], sortable: false },
              { key: "e", label: "Exposed", value: (d) => usd(d.exposed_kusd), numeric: true, sortable: false },
              { key: "r", label: "Reallocated", value: (d) => usd(d.reallocated_kusd), numeric: true, sortable: false },
              { key: "u", label: "Unmet", value: (d) => usd(d.unmet_kusd), numeric: true, sortable: false },
              { key: "a", label: "Alternatives used", value: (d) => d.n_alternatives_used, numeric: true, sortable: false },
            ]}
          />
        </Section>
      </div>

      <LearnedCapacity basket={basket} basketLabel={basketLabel} name={name} />

      <div className="grid gap-10 [&>*]:min-w-0 lg:grid-cols-[3fr_2fr]">
        <Section
          title="Most affected importers"
          description="Unmet demand as a share of each importer's imports from all partners, under the selected capacity assumption."
          note={hasMC ? `Dots: the selected capacity. Bands: ${mcText}.` : "Dots: the selected capacity."}
        >
          <PlotFigure
            deps={[top, colors]}
            label={`Fifteen importers with the largest unmet demand in the scenario.`}
            make={(width) => ({
              width, height: 28 * top.length + 50, marginLeft: 170, marginRight: 20,
              x: { label: "Unmet demand, share of imports (scenario) →", tickFormat: "%", grid: true },
              y: { label: null, domain: top.map((d) => d.label) },
              marks: [
                Plot.gridX({ strokeOpacity: 0.06 }),
                Plot.ruleY(top.filter((d) => d.unmet_share_p5 != null), { y: "label", x1: "unmet_share_p5", x2: "unmet_share_p95", stroke: "#93a8ba", strokeWidth: 8, strokeOpacity: 0.22 }),
                Plot.dot(top, { y: "label", x: "unmet_share", r: 5, fill: UNMET, stroke: BG }),
                Plot.ruleX([0], { strokeOpacity: 0.3 }),
                Plot.tip(top, Plot.pointerY({
                  y: "label", x: "unmet_share", ...TIP,
                  title: (d: (typeof top)[number]) => `${d.label}\nUnmet ${pct(d.unmet_share)} of imports (${usd(d.unmet_kusd)})${d.unmet_share_p5 != null ? `\nRange ${pct(d.unmet_share_p5)} – ${pct(d.unmet_share_p95)}` : ""}`,
                })),
              ],
            })}
          />
        </Section>
        <Section title="Assumption ledger" description="Every number on this page except the base year's flows is model output under these assumptions.">
          <ol className="list-decimal space-y-3 rounded-lg border border-[var(--tg-scenario)]/30 bg-card/60 p-5 pl-9 text-sm text-muted-foreground marker:text-[var(--tg-scenario)]">
            <li><span className="text-foreground">Base year:</span> {S?.year ?? "…"} observed flows (CEPII BACI). Every other number is scenario output.</li>
            <li><span className="text-foreground">Shortfall:</span> {supName} delivers {shortfall * 100}% less to every importer, for one year.</li>
            <li><span className="text-foreground">Capacity ({CAP_LABEL[capacity]}):</span> {CAP_TEXT[capacity]}. {learnedMC ? "This is learned from what happened after past falls, not a measure of spare capacity in a sudden crisis; most past falls were smaller than this scenario's shock." : "This share is an assumption, not a measure of real spare capacity."}</li>
            <li><span className="text-foreground">Competition:</span> importers compete for the same alternative capacity. The model first gives every reachable importer the same fill rate, then uses any leftover capacity, preferring existing trade links. Only the 40 largest alternative exporters are considered.</li>
            <li><span className="text-foreground">Not modelled:</span> prices, stockpiles, demand response, product differences within the basket, contracts, logistics, policy, or knock-on effects on third countries. No welfare or GDP effects are implied.</li>
          </ol>
        </Section>
      </div>

      <Section title={`All affected importers (${imp.length})`} note="Values in thousand current USD. Denominator for the share: each importer's imports of this basket from all partners in the base year.">
        <DataTable rows={imp} columns={impCols} rowKey={(d) => d.importer_iso3} initialSort={{ key: "u", desc: true }} caption="All affected importers" />
      </Section>
      <Section title="Largest reallocated flows" description="The 30 largest alternative-supplier to importer flows the model reallocates (the teal lines on the map).">
        <DataTable rows={flows} columns={flowCols} rowKey={(d) => `${d.alternative_iso3}-${d.importer_iso3}`} initialSort={{ key: "v", desc: true }} caption="Largest reallocated flows" />
      </Section>
    </Page>
  );
}

function arcPath([x1, y1]: [number, number], [x2, y2]: [number, number], bow: number) {
  const cx = (x1 + x2) / 2 - (y2 - y1) * bow, cy = (y1 + y2) / 2 + (x2 - x1) * bow;
  return `M${x1},${y1}Q${cx},${cy} ${x2},${y2}`;
}

function ScenarioMap({ geo, imp, flows, supplier, name, label }: {
  geo: Geo; imp: Imp[]; flows: Flow[]; supplier: string; name: (c: string) => string; label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  const [hover, setHover] = useState<{ x: number; y: number; iso3: string } | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(300, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = Math.round(width * 0.5);
  const { path, proj } = useMemo(() => {
    const proj = d3.geoEqualEarth().fitExtent([[6, 6], [width - 6, height - 6]], { type: "Sphere" });
    return { proj, path: d3.geoPath(proj) };
  }, [width, height]);
  const byImp = useMemo(() => new Map(imp.map((d) => [d.importer_iso3, d])), [imp]);
  const color = d3.scaleSequentialSqrt([0, Math.max(0.05, d3.max(imp, (d) => d.unmet_share) ?? 0)], d3.interpolateRgb("#24343d", SCEN));
  const P = (iso3: string) => {
    const a = geo.anchor.get(iso3);
    return a ? (proj(a) as [number, number] | null) : null;
  };
  const from = P(supplier);
  const topLost = imp.toSorted((a, b) => b.exposed_kusd - a.exposed_kusd).slice(0, 40);
  const wl = d3.scaleSqrt([0, d3.max(topLost, (d) => d.exposed_kusd) ?? 1], [0.6, 6]);
  const wr = d3.scaleSqrt([0, d3.max(flows, (d) => d.reallocated_kusd) ?? 1], [0.6, 5]);
  const h = hover ? byImp.get(hover.iso3) : undefined;

  return (
    <div ref={wrap} className="relative w-full" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full">
        <path d={path({ type: "Sphere" }) ?? ""} fill="#0a1013" stroke="#ffffff1a" />
        <path d={path(d3.geoGraticule10()) ?? ""} fill="none" stroke="#ffffff0d" />
        <g>
          {geo.countries.features.map((f, i) => {
            const iso3 = f.properties?.iso3;
            const r = iso3 ? byImp.get(iso3) : undefined;
            const fill = iso3 === supplier ? "#5a4a2a" : r ? color(r.unmet_share) : "#1b2830";
            return (
              <path
                key={i}
                d={path(f) ?? ""}
                fill={fill}
                stroke={hover?.iso3 === iso3 && iso3 ? "#e6edf3" : BG}
                strokeWidth={hover?.iso3 === iso3 && iso3 ? 1.2 : 0.5}
                onPointerMove={(e) => {
                  if (!iso3) return setHover(null);
                  const b = wrap.current!.getBoundingClientRect();
                  setHover({ x: e.clientX - b.left, y: e.clientY - b.top, iso3 });
                }}
              />
            );
          })}
        </g>
        <g fill="none" strokeLinecap="round" style={{ mixBlendMode: "screen", pointerEvents: "none" }}>
          {from && topLost.map((r) => {
            const to = P(r.importer_iso3);
            return to ? <path key={`l-${r.importer_iso3}`} d={arcPath(from, to, 0.2)} stroke={SCEN} strokeDasharray="6,4" strokeWidth={wl(r.exposed_kusd)} strokeOpacity={0.8} /> : null;
          })}
          {flows.map((r) => {
            const a = P(r.alternative_iso3), b = P(r.importer_iso3);
            return a && b ? (
              <path key={`r-${r.alternative_iso3}-${r.importer_iso3}`} d={arcPath(a, b, -0.18)} stroke={TEAL} strokeWidth={wr(r.reallocated_kusd)} strokeOpacity={r.existing_link ? 0.85 : 0.5} strokeDasharray={r.existing_link ? undefined : "2,3"} />
            ) : null;
          })}
        </g>
        {from && <circle cx={from[0]} cy={from[1]} r={7} fill={SCEN} stroke="#fff" strokeWidth={2} style={{ pointerEvents: "none" }} />}
      </svg>
      {hover && (
        <PointerCard x={hover.x} y={hover.y}>
          <p className="font-medium text-foreground">{name(hover.iso3)}</p>
          {hover.iso3 === supplier ? (
            <p className="mt-1 text-muted-foreground">Supplier assumed to fall short.</p>
          ) : h ? (
            <>
              <p className="text-xs text-[var(--tg-scenario)]">Scenario</p>
              <dl className="mt-2 space-y-1">
                <CardRow label="Exposed" value={usd(h.exposed_kusd)} />
                <CardRow label="Reallocated" value={usd(h.reallocated_kusd)} />
                <CardRow label="Unmet" value={usd(h.unmet_kusd)} strong />
                <CardRow label="Unmet, share of imports" value={pct(h.unmet_share)} />
              </dl>
            </>
          ) : (
            <p className="mt-1 text-muted-foreground">No recorded imports of this basket from {name(supplier)} in the base year.</p>
          )}
        </PointerCard>
      )}
    </div>
  );
}

type ModelRow = { mae_median: number; aggregate_error: number };
type Backtest = { n: number; n_events: number; coverage_q10_q90: number; models: Record<string, ModelRow> };
type SubMetrics = {
  training: { n_products: number; n_falls: number; n_alternative_rows: number; tonnes_basis_share: number; event_correlation: number };
  split_year: number; backtest_all_products: Backtest; backtest_baskets: Backtest | null; caveats: string[];
  rules: { drop: number; min_share: number; world_floor: number };
};
type FallRow = { shocked_iso3: string; year: number; fall: number; tonnes_basis: number; lost_kusd: number; expansion_kusd: number | null; gap_filled_share: number | null; realised_alpha: number | null };
const METHOD_LABEL: Record<string, string> = {
  learned: "Learned (this model)", fixed_5pct: "Fixed 5% (Low)", fixed_15pct: "Fixed 15% (Central)", fixed_30pct: "Fixed 30% (High)", own_trend: "Each supplier's own recent trend",
};

// Evidence for the learned capacity: what it is trained on, how it did on held-out years, and real falls in this basket.
function LearnedCapacity({ basket, basketLabel, name }: { basket: string; basketLabel: string; name: (c: string) => string }) {
  const m = useJson<SubMetrics>("substitution_metrics.json");
  const falls = useQuery<FallRow>(
    `SELECT shocked_iso3, year, fall, tonnes_basis, lost_kusd, expansion_kusd, gap_filled_share, realised_alpha FROM substitution_events WHERE basket_id = ? ORDER BY year DESC, lost_kusd DESC`,
    [basket],
  );
  if (!m) return null;
  const bt = m.backtest_all_products;
  const rows = Object.entries(bt.models).map(([k, v]) => ({ k, label: METHOD_LABEL[k] ?? k, ...v, b: m.backtest_baskets?.models[k] }));
  const best = Math.min(...rows.map((r) => r.aggregate_error));
  return (
    <Section
      title="Where the learned capacity comes from"
      description={`A model, not an assumption: it learned from ${m.training.n_falls.toLocaleString("en-US")} cases in ${m.training.n_products.toLocaleString("en-US")} products where one supplier's exports fell by ${pct(m.rules.drop, 0)} or more in a year while world trade held up, how much each of the other suppliers expanded the next year. Growth is measured in tonnes where reported (${pct(m.training.tonnes_basis_share, 0)} of cases), so price swings don't count as expansion.`}
      note={<>Backtest: trained on falls up to {m.split_year}, tested on {bt.n_events.toLocaleString("en-US")} later falls ({m.split_year + 1}–2024) the model never saw. "Error" is the total expansion error: predicted vs actual added exports of all alternatives together, as a share of their exports; it is what a scenario uses. Lower is better. {m.caveats.join(" ")}</>}
    >
      <div className="grid gap-8 [&>*]:min-w-0 lg:grid-cols-[3fr_2fr]">
        <DataTable
          rows={rows}
          rowKey={(d) => d.k}
          maxHeight="none"
          caption="Backtest on held-out falls"
          columns={[
            { key: "m", label: "Capacity method", value: (d) => d.label, render: (d) => <span className={d.k === "learned" ? "font-medium text-foreground" : ""}>{d.label}</span>, sortable: false },
            { key: "a", label: "Error, all products", value: (d) => d.aggregate_error, render: (d) => <span className={d.aggregate_error === best ? "font-medium text-[var(--tg-teal)]" : ""}>{pct(d.aggregate_error, 1)}</span>, numeric: true, sortable: false },
            { key: "e", label: "Per supplier", value: (d) => d.mae_median, render: (d) => d.mae_median.toFixed(2), numeric: true, sortable: false },
            { key: "b", label: `Error, baskets (${m.backtest_baskets?.n_events ?? 0})`, value: (d) => d.b?.aggregate_error ?? null, render: (d) => (d.b ? pct(d.b.aggregate_error, 1) : "–"), numeric: true, sortable: false },
          ]}
        />
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            The learned ranges contain the actual outcome {pct(bt.coverage_q10_q90, 0)} of the time (target 80%). Alternatives' surprises are correlated within a fall (ρ = {m.training.event_correlation.toFixed(2)}), so the uncertainty range draws them together, not independently.
          </p>
          <h3 className="pt-2 font-medium text-foreground">Real falls in {basketLabel.toLowerCase()}</h3>
          {(falls.data ?? []).length === 0 ? (
            <p className="text-muted-foreground">No supplier's exports of this basket fell by {pct(m.rules.drop, 0)} or more in one year while world trade held up.</p>
          ) : (
            <ul className="space-y-1.5">
              {(falls.data ?? []).slice(0, 8).map((f) => (
                <li key={`${f.shocked_iso3}-${f.year}`} className="text-muted-foreground">
                  <span className="text-foreground">{name(f.shocked_iso3)}, {f.year}–{f.year + 1}:</span> exports fell {pct(f.fall, 0)}
                  {f.tonnes_basis ? " (tonnes)" : " (value)"}; others added {usd(f.expansion_kusd)}
                  {f.realised_alpha != null ? `, ${pct(f.realised_alpha, 0)} of their exports` : ""}.
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}
