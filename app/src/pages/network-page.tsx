import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { BasketSelect, YearSlider } from "@/components/controls";
import { Page, Section, Swatch } from "@/components/page";
import { PlotFigure, TIP } from "@/components/plot-figure";
import { CardRow, PointerCard } from "@/components/pointer-card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useJson, useQuery } from "@/lib/db";
import { countryName, flowColor, pct, usd } from "@/lib/format";
import { useCountryColors, type RGB } from "@/lib/country-colors";
import { latestFinalYear, useBuildInfo } from "@/lib/meta";
import { DataTable, LineKey, PlotLegend, fmtInt, fmtRatio, type Column } from "./network-page-table";

type NodeRow = {
  iso3: string; country_name: string; exports_kusd: number; imports_kusd: number;
  centrality: number; centrality_expected: number; community: number;
};
type EdgeRow = { exporter_iso3: string; importer_iso3: string; value_kusd: number; expected_kusd: number | null };
type Node = NodeRow & { name: string; ratio: number | null };
type SimNode = Node & d3.SimulationNodeDatum & { id: string };
type SimLink = { source: SimNode; target: SimNode; value: number };
type Coef = { estimate: number; se: number };
type GravityFit = {
  covariates: string;
  baskets: Record<string, {
    label: string;
    main: { coefficients: Record<string, Coef>; n_obs: number; n_rows_without_covariates: number };
    robustness_drop_smallest: { share_excluded: number; coefficients: Record<string, Coef>; corr_expected_shares_vs_main?: number };
  }>;
};
type ColorBy = "community" | "country" | "gravity";

const BG = "#0e1519";
const GREY = "#6c7a80";
const rgb = (c?: RGB) => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : GREY);
const diverging = d3.scaleDiverging([-2, 0, 2], d3.interpolateRdBu).unknown(GREY);
const COEF_NAMES: Record<string, string> = {
  ldist: "Log distance", contig: "Shared border", comlang: "Common official language", colony: "Colonial tie (ever)",
  rta: "Trade agreement in force", cov_missing: "Covariate imputed (indicator)",
};

// Quadratic arc from a to b, bowed sideways; the end is pulled back by `trim` px so arrowheads sit outside the node.
function arc(a: [number, number], b: [number, number], bow: number, trim: number) {
  const [x1, y1] = a, [x2, y2] = b;
  const cx = (x1 + x2) / 2 - (y2 - y1) * bow, cy = (y1 + y2) / 2 + (x2 - x1) * bow;
  const dx = x2 - cx, dy = y2 - cy, len = Math.hypot(dx, dy) || 1;
  return `M${x1},${y1}Q${cx},${cy} ${x2 - (dx / len) * trim},${y2 - (dy / len) * trim}`;
}

export function NetworkPage() {
  const info = useBuildInfo();
  const fit = useJson<GravityFit>("gravity_fit.json");
  const colors = useCountryColors();
  const [basket, setBasket] = useState("rare_earths_and_magnets");
  const [year, setYear] = useState<number | null>(null);
  const [topN, setTopN] = useState(150);
  const [colorBy, setColorBy] = useState<ColorBy>("community");
  useEffect(() => {
    if (info && year == null) setYear(latestFinalYear(info));
  }, [info, year]);

  const nodesQ = useQuery<NodeRow>(
    `SELECT iso3, country_name, exports_kusd, imports_kusd, centrality, centrality_expected, community FROM network_nodes WHERE basket_id = ? AND year = ?`,
    [basket, year ?? 0],
  );
  const edgesQ = useQuery<EdgeRow>(
    `SELECT exporter_iso3, importer_iso3, value_kusd, expected_kusd FROM network_edges WHERE basket_id = ? AND year = ? ORDER BY value_kusd DESC`,
    [basket, year ?? 0],
  );
  const nodes = useMemo<Node[]>(
    () => (nodesQ.data ?? []).map((d) => ({ ...d, name: countryName(d.iso3, d.country_name), ratio: d.centrality_expected > 0 ? d.centrality / d.centrality_expected : null })),
    [nodesQ.data],
  );
  const byIso = useMemo(() => new Map(nodes.map((d) => [d.iso3, d])), [nodes]);
  const edgesAll = edgesQ.data ?? [];
  const edges = useMemo(() => edgesAll.slice(0, topN), [edgesAll, topN]);
  const nameOf = (c: string) => byIso.get(c)?.name ?? countryName(c);
  const colorOf = (c: string) => rgb(colors?.get(c));

  const basketLabel = info?.baskets.find((b) => b.id === basket)?.label ?? basket;
  const provisional = year != null && info?.provisional_years.includes(year);
  const ranked = useMemo(() => nodes.toSorted((a, b) => b.centrality - a.centrality), [nodes]);
  const f = fit?.baskets[basket];

  const nodeCols: Column<Node & { rank: number }>[] = [
    { key: "rank", label: "Rank", value: (d) => d.rank, numeric: true },
    { key: "name", label: "Country", value: (d) => d.name, render: (d) => <span className="inline-flex items-center gap-2"><Swatch color={colorOf(d.iso3)} />{d.name}</span> },
    { key: "exports", label: "Exports (k USD)", value: (d) => d.exports_kusd, render: (d) => fmtInt(d.exports_kusd), numeric: true },
    { key: "imports", label: "Imports (k USD)", value: (d) => d.imports_kusd, render: (d) => fmtInt(d.imports_kusd), numeric: true },
    { key: "c", label: "Centrality", value: (d) => d.centrality, render: (d) => pct(d.centrality, 2), numeric: true },
    { key: "ce", label: "Gravity-expected", value: (d) => d.centrality_expected, render: (d) => pct(d.centrality_expected, 2), numeric: true },
    { key: "ratio", label: "Centrality vs gravity", value: (d) => d.ratio, render: (d) => fmtRatio(d.ratio), numeric: true },
  ];
  type LinkRow = EdgeRow & { ratio: number | null };
  const linkCols: Column<LinkRow>[] = [
    { key: "e", label: "Exporter", value: (d) => nameOf(d.exporter_iso3), render: (d) => <span className="inline-flex items-center gap-2"><Swatch color={colorOf(d.exporter_iso3)} />{nameOf(d.exporter_iso3)}</span> },
    { key: "i", label: "Importer", value: (d) => nameOf(d.importer_iso3), render: (d) => <span className="inline-flex items-center gap-2"><Swatch color={colorOf(d.importer_iso3)} />{nameOf(d.importer_iso3)}</span> },
    { key: "v", label: "Value (k USD)", value: (d) => d.value_kusd, render: (d) => fmtInt(d.value_kusd), numeric: true },
    { key: "x", label: "Gravity-expected (k USD)", value: (d) => d.expected_kusd, render: (d) => fmtInt(d.expected_kusd), numeric: true },
    { key: "r", label: "Observed ÷ expected", value: (d) => d.ratio, render: (d) => fmtRatio(d.ratio), numeric: true },
  ];
  const linkRows = useMemo<LinkRow[]>(
    () => edgesAll.slice(0, 250).map((e) => ({ ...e, ratio: e.expected_kusd && e.expected_kusd > 0 ? e.value_kusd / e.expected_kusd : null })),
    [edgesAll],
  );

  const dumbbell = ranked.slice(0, 20).map((d) => ({ ...d, label: d.name }));

  return (
    <Page
      wide
      title="Who sits at the centre of each product network?"
      lead="Countries linked by recorded trade in one product basket, grouped into trade communities. Supplier centrality is set against what a gravity model expects from distance, borders, language, colonial ties, trade agreements and each country's size in the basket."
      meta={
        <>
          <Badge variant="outline">Observed network</Badge>
          <Badge variant="outline">Model baseline: gravity (PPML)</Badge>
          <Badge variant="outline">CEPII BACI {info?.source.hs_revision} V{info?.source.release}, CEPII Gravity</Badge>
          {provisional && <Badge variant="outline" className="border-[var(--tg-scenario)] text-[var(--tg-scenario)]">{year} provisional</Badge>}
        </>
      }
      actions={
        <>
          <BasketSelect info={info} value={basket} onChange={setBasket} />
          <YearSlider info={info} value={year} onChange={setYear} className="w-48" />
          <div className="w-44 space-y-2">
            <div className="flex justify-between text-sm"><Label>Links drawn</Label><span className="text-foreground tabular-nums">{topN}</span></div>
            <Slider aria-label="Largest links drawn" min={20} max={250} step={10} value={topN} onValueChange={(v) => setTopN(v as number)} />
          </div>
        </>
      }
    >
      <Section
        title={`${basketLabel}, ${year ?? "…"}`}
        description={
          <>
            All {nodes.filter((d) => d.community >= 0).length} trading countries, with the {edges.length} largest recorded links drawn. Links run from exporter to importer (arrowhead at the importer); width shows recorded value in current USD.
            These are statistical links, not shipping routes. Node size shows the country's total trade in this basket. Positions are a layout, not geography.
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <ToggleGroup value={[colorBy]} onValueChange={(v) => v[0] && setColorBy(v[0] as ColorBy)} aria-label="Colour nodes by">
              <ToggleGroupItem value="community">Trade community</ToggleGroupItem>
              <ToggleGroupItem value="country">Country</ToggleGroupItem>
              <ToggleGroupItem value="gravity">Relative to gravity</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {colorBy === "gravity" && (
            <PlotLegend
              deps={[]}
              options={{
                color: { type: "diverging", scheme: "RdBu", domain: [-2, 2], pivot: 0, label: "Supplier centrality ÷ gravity-expected centrality", tickFormat: (d: number) => `×${(2 ** d).toFixed(d < 0 ? 2 : 0)}`, ticks: [-2, -1, 0, 1, 2] },
              }}
            />
          )}
        </div>
        <div className="overflow-hidden rounded-lg border bg-[var(--tg-ink)]">
          {nodesQ.loading && nodes.length === 0 ? (
            <p className="p-10 text-sm text-muted-foreground">Loading network…</p>
          ) : (
            <NetworkChart nodes={nodes} edges={edges} colorBy={colorBy} colors={colors} label={`Trade network of ${basketLabel} in ${year}. Full numbers in the tables below.`} />
          )}
        </div>
        <NetworkKey nodes={nodes} colorBy={colorBy} />
      </Section>

      <Section
        title="Supplier centrality against the gravity baseline"
        description="The 20 most central suppliers. A filled dot is observed centrality (PageRank on the supplier side, a share of the network's total); the hollow dot is what the gravity model's expected trade pattern would give. A gap to the right means more central than geography and size alone suggest."
        note="Centrality is descriptive: high values mean a country supplies large shares to importers that are themselves central. It does not prove that a supplier is indispensable."
      >
        <PlotFigure
          deps={[dumbbell, colors]}
          label={`Observed and gravity-expected supplier centrality for the 20 most central suppliers of ${basketLabel} in ${year}.`}
          make={(width) => ({
            width, height: 26 * dumbbell.length + 50, marginLeft: 190, marginRight: 24,
            x: { label: "Supplier centrality (share of network) →", tickFormat: (d: number) => `${(100 * d).toFixed(0)}%`, grid: true },
            y: { label: null, domain: dumbbell.map((d) => d.label) },
            color: { legend: true, domain: ["Observed", "Gravity-expected"], range: ["#e6edf3", "#93a8ba"] },
            marks: [
              Plot.gridX({ strokeOpacity: 0.06 }),
              Plot.ruleY(dumbbell, { y: "label", x1: "centrality_expected", x2: "centrality", stroke: "#93a8ba", strokeOpacity: 0.4 }),
              Plot.dot(dumbbell, { y: "label", x: "centrality_expected", r: 4.5, stroke: "#93a8ba", fill: BG, symbol: "circle" }),
              Plot.dot(dumbbell, { y: "label", x: "centrality", r: 5, fill: (d: Node) => colorOf(d.iso3), stroke: BG }),
              Plot.tip(dumbbell, Plot.pointerY({
                y: "label", x: "centrality", ...TIP,
                title: (d: Node) => `${d.name}\nCentrality ${pct(d.centrality, 1)}\nGravity-expected ${pct(d.centrality_expected, 1)}\nRatio ${fmtRatio(d.ratio)}`,
              })),
            ],
          })}
        />
      </Section>

      <div className="space-y-14">
        <Section
          title="Countries by supplier centrality"
          description="Each country's total exports and imports are reproduced exactly by the gravity model (a property of PPML with country-year effects). The comparison that carries information is who trades with whom, which is what centrality vs gravity measures."
          note={`Denominator: all partners recorded in BACI for this basket and year. Values in thousand current USD.`}
        >
          <DataTable rows={ranked.map((d, i) => ({ ...d, rank: i + 1 }))} columns={nodeCols} rowKey={(d) => d.iso3} initialSort={{ key: "rank" }} caption="Countries by supplier centrality" />
        </Section>
        <Section title="Largest links" description="The 250 largest recorded exporter-to-importer links, with the value the gravity model expects for that pair." note="Observed ÷ expected above 1: the pair trades more than distance, borders, language, colonial ties, agreements and size predict.">
          <DataTable rows={linkRows} columns={linkCols} rowKey={(d) => `${d.exporter_iso3}-${d.importer_iso3}`} initialSort={{ key: "v", desc: true }} caption="Largest links" />
        </Section>
      </div>

      {f && fit && (
        <Section
          title="Gravity model for this basket"
          description={
            <>
              PPML with exporter-year and importer-year fixed effects, on {f.main.n_obs.toLocaleString("en-US")} country-pair-years, 2012–2024. Modelling assumption: inside this model only, country pairs with no recorded trade count as zero, which PPML requires.{" "}
              {f.main.n_rows_without_covariates.toLocaleString("en-US")} pair-years involve entities with no gravity covariates and are left out. Where CEPII leaves a border, language or colonial-tie value missing, it is filled from the reverse pair or set to 0 and flagged.
              The robustness run drops the smallest {Math.round(100 * f.robustness_drop_smallest.share_excluded)}% of economies; correlation of gravity-expected supplier shares with the main run: {f.robustness_drop_smallest.corr_expected_shares_vs_main?.toFixed(3) ?? "–"}.
            </>
          }
          note={`Coefficients describe average associations in this basket's trade. They are not causal effects. ${fit.covariates.includes("True") ? "Trade-agreement status after 2021 is carried forward from 2021, so agreements that started later (e.g. RCEP in 2022) are not captured." : "The last covariate year is not extended."}`}
        >
          <DataTable
            rows={Object.entries(f.main.coefficients).map(([k, v]) => ({ k, ...v, rob: f.robustness_drop_smallest.coefficients[k]?.estimate }))}
            rowKey={(d) => d.k}
            maxHeight="none"
            caption="Gravity coefficients"
            columns={[
              { key: "k", label: "Variable", value: (d) => COEF_NAMES[d.k] ?? d.k, sortable: false },
              { key: "e", label: "Estimate", value: (d) => d.estimate, render: (d) => d.estimate.toFixed(3), numeric: true, sortable: false },
              { key: "se", label: "Std. error", value: (d) => d.se, render: (d) => d.se.toFixed(3), numeric: true, sortable: false },
              { key: "eff", label: "Effect on expected trade", value: (d) => (d.k === "ldist" ? `1% farther: ${d.estimate.toFixed(2)}%` : `×${Math.exp(d.estimate).toFixed(2)}`), sortable: false },
              { key: "rob", label: "Robustness run", value: (d) => d.rob, render: (d) => (d.rob == null ? "–" : d.rob.toFixed(3)), numeric: true, sortable: false },
            ]}
          />
        </Section>
      )}
    </Page>
  );
}

function NetworkKey({ nodes, colorBy }: { nodes: Node[]; colorBy: ColorBy }) {
  const groups = useMemo(() => {
    const trade = (d: Node) => d.exports_kusd + d.imports_kusd;
    return [...d3.group(nodes.filter((d) => d.community >= 0 && trade(d) > 0), (d) => d.community)]
      .filter(([, m]) => m.length >= 2)
      .map(([c, m]) => ({ c, head: d3.greatest(m, trade)!, n: m.length, exports: d3.sum(m, (d) => d.exports_kusd) }))
      .sort((a, b) => b.exports - a.exports);
  }, [nodes]);
  if (colorBy === "community")
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Colour: trade communities, groups of countries that trade intensely with each other (Louvain algorithm). These are algorithmic groupings, not political blocs. Community colours are separate from the fixed country colours. Links take the exporter's community colour.
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {groups.map((g) => (
            <li key={g.c} className="inline-flex items-center gap-2">
              <Swatch color={flowColor(g.c)} />
              <span className="text-foreground">{g.head.name} community</span>
              <span className="text-muted-foreground">{g.n} countries, {usd(g.exports)} exports</span>
            </li>
          ))}
        </ul>
      </div>
    );
  if (colorBy === "country")
    return <p className="text-xs text-muted-foreground">Colour: each country's fixed identity colour, the same as on the trade map. Links take the importer's colour, as flows do on the map.</p>;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <p className="text-xs text-muted-foreground">Colour: blue = more central as a supplier than gravity predicts, red = less, grey = no gravity estimate.</p>
      <LineKey color="#9fb0b8">Link (grey in this view)</LineKey>
    </div>
  );
}

function NetworkChart({ nodes, edges, colorBy, colors, label }: {
  nodes: Node[]; edges: EdgeRow[]; colorBy: ColorBy; colors: Map<string, RGB> | null; label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  const [hover, setHover] = useState<{ x: number; y: number; node?: SimNode; link?: SimLink } | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = Math.round(Math.min(760, Math.max(460, width * 0.62)));

  // Static, deterministic layout (as on the legacy page): communities pulled to anchors around an ellipse.
  const layout = useMemo(() => {
    const trade = (d: Node) => d.exports_kusd + d.imports_kusd;
    const ns: SimNode[] = nodes.filter((d) => d.community >= 0 && trade(d) > 0).map((d) => ({ ...d, id: d.iso3 }));
    const inGraph = new Map(ns.map((d) => [d.id, d]));
    const ls: SimLink[] = edges
      .filter((e) => inGraph.has(e.exporter_iso3) && inGraph.has(e.importer_iso3))
      .map((e) => ({ source: inGraph.get(e.exporter_iso3)!, target: inGraph.get(e.importer_iso3)!, value: e.value_kusd }));
    const size = d3.scaleSqrt().domain([0, d3.max(ns, trade) ?? 1]).range([1.6, 24]);
    const comms = d3.sort(new Set(ns.map((d) => d.community)), (c) => c);
    const anchorOf = new Map(comms.map((c, i) => {
      const a = (i / Math.max(1, comms.length)) * 2 * Math.PI - Math.PI / 2;
      const r = comms.length > 1 ? 0.33 : 0;
      return [c, [width / 2 + Math.cos(a) * width * r, height / 2 + Math.sin(a) * height * r]] as const;
    }));
    const sim = d3.forceSimulation(ns)
      .force("link", d3.forceLink<SimNode, SimLink>(ls).distance(40).strength((l) => (l.source.community === l.target.community ? 0.12 : 0)))
      .force("charge", d3.forceManyBody().strength(-14))
      .force("x", d3.forceX<SimNode>((d) => anchorOf.get(d.community)![0]).strength(0.5))
      .force("y", d3.forceY<SimNode>((d) => anchorOf.get(d.community)![1]).strength(0.5))
      .force("collide", d3.forceCollide<SimNode>((d) => size(trade(d)) + 2))
      .stop();
    for (let i = 0; i < 500; ++i) sim.tick();
    const pad = 46;
    const [x0, x1] = d3.extent(ns, (d) => d.x!) as [number, number];
    const [y0, y1] = d3.extent(ns, (d) => d.y!) as [number, number];
    const k = Math.min((width - 2 * pad) / Math.max(1, x1 - x0), (height - 2 * pad) / Math.max(1, y1 - y0));
    for (const d of ns) {
      d.x = pad + (d.x! - x0) * k + (width - 2 * pad - (x1 - x0) * k) / 2;
      d.y = pad + (d.y! - y0) * k + (height - 2 * pad - (y1 - y0) * k) / 2;
    }
    const labelled = new Set(d3.sort(ns, (d) => -trade(d)).slice(0, 16).map((d) => d.id));
    return { ns, ls, size: (d: Node) => size(trade(d)), labelled, maxV: d3.max(ls, (d) => d.value) ?? 1 };
  }, [nodes, edges, width, height]);

  const { ns, ls, size, labelled, maxV } = layout;
  const w = d3.scaleSqrt([0, maxV], [0.3, 5]);
  const fill = (d: Node) =>
    colorBy === "community" ? flowColor(d.community) : colorBy === "country" ? rgb(colors?.get(d.iso3)) : diverging(d.ratio == null ? NaN : Math.log2(d.ratio));
  const stroke = (l: SimLink) =>
    colorBy === "community" ? flowColor(l.source.community) : colorBy === "country" ? rgb(colors?.get(l.target.iso3)) : "#9fb0b8";
  const markerColors = [...new Set(ls.map(stroke))];
  const markerId = (c: string) => `nw-arrow-${markerColors.indexOf(c)}`;
  const focus = hover?.node?.id;
  const move = (e: React.PointerEvent, h: { node?: SimNode; link?: SimLink }) => {
    const r = wrap.current!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, ...h });
  };

  return (
    <div ref={wrap} className="relative w-full" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full">
        <defs>
          {markerColors.map((c) => (
            <marker key={c} id={markerId(c)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,1L10,5L0,9z" fill={c} />
            </marker>
          ))}
        </defs>
        <g fill="none" style={{ mixBlendMode: "screen" }}>
          {ls.map((l, i) => {
            const dim = focus && l.source.id !== focus && l.target.id !== focus;
            return (
              <path
                key={i}
                d={arc([l.source.x!, l.source.y!], [l.target.x!, l.target.y!], 0.12, size(l.target) + 2)}
                stroke={stroke(l)}
                strokeOpacity={dim ? 0.05 : 0.18 + 0.6 * Math.sqrt(l.value / maxV)}
                strokeWidth={w(l.value)}
                markerEnd={`url(#${markerId(stroke(l))})`}
                onPointerMove={(e) => move(e, { link: l })}
              />
            );
          })}
        </g>
        <g>
          {ns.map((d) => (
            <g key={d.id} transform={`translate(${d.x},${d.y})`} onPointerMove={(e) => move(e, { node: d })} style={{ cursor: "default" }}>
              <circle r={size(d)} fill={fill(d)} fillOpacity={focus && focus !== d.id ? 0.35 : 0.92} stroke={focus === d.id ? "#fff" : BG} strokeWidth={focus === d.id ? 1.5 : 0.8} style={{ filter: `drop-shadow(0 0 4px ${fill(d)})` }} />
              {labelled.has(d.id) && (
                <text dy={size(d) + 11} textAnchor="middle" fill="#93a8ba" fontSize={10.5} style={{ paintOrder: "stroke", stroke: BG, strokeWidth: 3 }}>{d.id}</text>
              )}
            </g>
          ))}
        </g>
      </svg>
      {hover?.node && (
        <PointerCard x={hover.x} y={hover.y}>
          <p className="flex items-center gap-2 font-medium text-foreground"><Swatch color={rgb(colors?.get(hover.node.iso3))} />{hover.node.name}</p>
          <p className="text-xs text-muted-foreground">Trade community: {hover.node.community + 1}</p>
          <dl className="mt-2 space-y-1">
            <CardRow label="Exports" value={usd(hover.node.exports_kusd)} />
            <CardRow label="Imports" value={usd(hover.node.imports_kusd)} />
            <CardRow label="Supplier centrality" value={pct(hover.node.centrality, 1)} strong />
            <CardRow label="Gravity-expected" value={pct(hover.node.centrality_expected, 1)} />
            <CardRow label="Centrality vs gravity" value={fmtRatio(hover.node.ratio)} />
          </dl>
        </PointerCard>
      )}
      {hover?.link && (
        <PointerCard x={hover.x} y={hover.y}>
          <p className="font-medium text-foreground">{hover.link.source.name} to {hover.link.target.name}</p>
          <p className="figure mt-1 text-xl text-foreground">{usd(hover.link.value)}</p>
          <p className="text-xs text-muted-foreground">Recorded trade, current USD (observed)</p>
        </PointerCard>
      )}
    </div>
  );
}
