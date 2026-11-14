import { _GlobeView as GlobeView, MapView, WebMercatorViewport, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { TripsLayer } from "@deck.gl/geo-layers";
import { BitmapLayer, GeoJsonLayer, LineLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { cutPolylineByGrid } from "@math.gl/polygon";
import { geoInterpolate } from "d3";
import { useEffect, useMemo, useState } from "react";
import { CountrySheet } from "@/components/country-sheet";
import { HoverCard } from "@/components/hover-card";
import { SidebarPanel } from "@/components/sidebar-panel";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GLOW_BOUNDS, paintBorderGlow, type GlowSpec } from "@/lib/border-glow";
import { useCountryColors, type RGB } from "@/lib/country-colors";
import { useQuery } from "@/lib/db";
import { usd } from "@/lib/format";
import { unwrapCountries, unwrapLongitudes, useGeo } from "@/lib/geo";
import { ADDITIVE, BORDER, GRID, GRID_DOT, GRID_DOTS, GRID_LINES, LAND, SEA, VIGNETTE, type RGBA } from "@/lib/map-style";
import { latestFinalYear, useBuildInfo } from "@/lib/meta";

type Edge = { e: string; i: string; v: number; imp_share: number; exp_share: number; rank: number };
type Node = { iso3: string; community: number; exports_kusd: number; imports_kusd: number };
type Hover = { kind: "arc"; x: number; y: number; edge: Edge } | { kind: "country"; x: number; y: number; iso3: string } | null;
type Segment = { from: [number, number]; to: [number, number]; color: RGBA; width: number; edge: Edge };
type Trip = { path: [number, number][]; timestamps: number[]; color: RGB; width: number };
type Trader = { n: Node; total: number; s: number };
type Placed = { n: Node; text: string; color: RGB; left: boolean };

const GREY: RGB = [124, 143, 161];
const STEPS = 28;
const LOOP = 1000;
const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Flat map: straight lon/lat line bowed sideways (never wraps the map edge). Globe: great circle, with continuous
// longitudes so a flow crossing the date line is not drawn the long way round the pole.
function flowPath(a: [number, number], b: [number, number], globe: boolean): [number, number][] {
  const gc = globe ? geoInterpolate(a, b) : null;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const bow = globe ? 0 : 0.18;
  const pts: [number, number][] = [];
  for (let k = 0; k <= STEPS; k++) {
    const t = k / STEPS;
    const [x, y] = gc ? (gc(t) as [number, number]) : [a[0] + dx * t, a[1] + dy * t];
    const lift = Math.sin(Math.PI * t) * bow * len;
    pts.push([x - (dy / len) * lift, y + (dx / len) * lift]);
  }
  return gc ? unwrapLongitudes(pts) : pts;
}

// Globe: deck.gl (9.4) re-cuts every path at its grid resolution, but TripsLayer still reads one timestamp per
// point of the CUT path. Handing it timestamps for the original points only lets the two fall out of step and whole
// flows flash on at once. So cut the path here with the same function and settings, and time every cut point.
const GLOBE_RESOLUTION = 5;
function globeTimestamps(path: [number, number][], ts: number[]): number[] {
  const flat = path.flatMap(([x, y]) => [x, y, 0]); // deck flattens positions to XYZ before cutting
  const cut = cutPolylineByGrid(flat, { size: 3, gridResolution: GLOBE_RESOLUTION }) as number[];
  const seg = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const L = [0];
  for (let k = 1; k < path.length; k++) L.push(L[k - 1] + seg(path[k - 1], path[k]));
  const out: number[] = [];
  let c = 0, k = 0;
  for (let i = 0; i < cut.length; i += 3) {
    if (i > 0) c += seg([cut[i - 3], cut[i - 2]], [cut[i], cut[i + 1]]);
    while (k < path.length - 2 && c > L[k + 1]) k++;
    const f = L[k + 1] > L[k] ? Math.min(1, Math.max(0, (c - L[k]) / (L[k + 1] - L[k]))) : 0;
    out.push(ts[k] + f * (ts[k + 1] - ts[k]));
  }
  return out;
}

const shortName = (s: string) =>
  s.replace(" (Other Asia, nes)", "").replace("Rep. of Korea", "Korea").replace("China, Hong Kong SAR", "Hong Kong").replace("Viet Nam", "Vietnam").replace("United Kingdom", "UK");

export function MapPage() {
  const info = useBuildInfo();
  const geo = useGeo();
  const colors = useCountryColors();
  const [basket, setBasket] = useState("integrated_circuits");
  const [year, setYear] = useState<number | null>(null);
  const [topN, setTopN] = useState(150);
  const [view, setView] = useState<"map" | "globe">("map");
  const [animate, setAnimate] = useState(!reducedMotion);
  const [hover, setHover] = useState<Hover>(null);
  const [keyFocus, setKeyFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [viewState, setViewState] = useState<MapViewState>({ longitude: 40, latitude: 24, zoom: 1.45, minZoom: 1, maxZoom: 6 });
  const [size, setSize] = useState({ width: 1200, height: 800 });
  // Build the label atlas only after the web font is ready (otherwise glyph metrics come from a fallback).
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    document.fonts.load('500 11px "Archivo Variable"').then(() => setFontReady(true));
  }, []);
  useEffect(() => {
    if (info && year == null) setYear(latestFinalYear(info));
  }, [info, year]);
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const tick = () => {
      setTime((t) => (t + 4) % LOOP);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const edges = useQuery<Edge>(
    `WITH ex AS (SELECT supplier_iso3, sum(value_kusd) AS t FROM supplier_basket_year WHERE basket_id = ? AND year = ? GROUP BY 1)
     SELECT e.exporter_iso3 AS e, e.importer_iso3 AS i, e.value_kusd AS v, s.share_value AS imp_share,
            e.value_kusd / ex.t AS exp_share, s.rank_value AS rank
     FROM network_edges e
     JOIN supplier_basket_year s ON s.basket_id = e.basket_id AND s.year = e.year AND s.importer_iso3 = e.importer_iso3 AND s.supplier_iso3 = e.exporter_iso3
     JOIN ex ON ex.supplier_iso3 = e.exporter_iso3
     WHERE e.basket_id = ? AND e.year = ? ORDER BY e.value_kusd DESC LIMIT ?`,
    [basket, year, basket, year, topN],
  );
  const nodes = useQuery<Node>(`SELECT iso3, community, exports_kusd, imports_kusd FROM network_nodes WHERE basket_id = ? AND year = ?`, [basket, year]);
  const nodeOf = useMemo(() => new Map((nodes.data ?? []).map((n) => [n.iso3, n])), [nodes.data]);
  const maxV = useMemo(() => Math.max(1, ...(edges.data ?? []).map((d) => d.v)), [edges.data]);
  const focus = keyFocus ?? (hover?.kind === "country" ? hover.iso3 : selected);
  // Globe: outlines crossing the date line (Russia, Fiji) need continuous longitudes, like the flows.
  const countries = useMemo(() => (geo ? (view === "globe" ? unwrapCountries(geo.countries) : geo.countries) : null), [geo, view]);
  const colorOf = (iso3: string): RGB => colors?.get(iso3) ?? GREY;

  // Countries on the drawn flows, with their trade in this basket and a 0..1 prominence (sqrt of size).
  const traders = useMemo(() => {
    const set = new Set((edges.data ?? []).flatMap((d) => [d.e, d.i]));
    const list = [...set].map((iso3) => nodeOf.get(iso3)).filter((n): n is Node => !!n && !!geo?.anchor.has(n.iso3));
    const max = Math.max(1, ...list.map((n) => n.exports_kusd + n.imports_kusd));
    return new Map<string, Trader>(list.map((n) => [n.iso3, { n, total: n.exports_kusd + n.imports_kusd, s: Math.sqrt((n.exports_kusd + n.imports_kusd) / max) }]));
  }, [edges.data, nodeOf, geo]);

  // Border glow texture: rebuilt only when the trading countries or their sizes change.
  const glow = useMemo(() => {
    if (!geo || !colors || traders.size === 0) return null;
    const spec = new Map<string, GlowSpec>([...traders].map(([iso3, t]) => [iso3, { color: colors.get(iso3) ?? GREY, strength: t.s }]));
    return paintBorderGlow(geo.countries, spec);
  }, [geo, colors, traders]);

  // Flow geometry: every flow takes the IMPORTER's colour, faint at the exporter and brightening on arrival.
  const { segments, trips } = useMemo(() => {
    const segs: Segment[] = [];
    const tr: Trip[] = [];
    if (!geo) return { segments: segs, trips: tr };
    for (const d of edges.data ?? []) {
      const a = geo.anchor.get(d.e), b = geo.anchor.get(d.i);
      if (!a || !b) continue;
      const path = flowPath(a, b, view === "globe");
      const rgb = colors?.get(d.i) ?? GREY;
      const s = Math.sqrt(d.v / maxV);
      const w = 0.7 + 3.3 * s;
      // Visible end to end without the pulse: a floor at the exporter, rising linearly to the importer.
      const base = 38 + 32 * s, rise = 55 + 85 * s;
      for (let k = 0; k < path.length - 1; k++) {
        const t = (k + 0.5) / (path.length - 1);
        segs.push({ from: path[k], to: path[k + 1], color: [rgb[0], rgb[1], rgb[2], Math.round(base + rise * t)], width: w, edge: d });
      }
      const offset = (d.e.charCodeAt(0) * 31 + d.i.charCodeAt(1) * 17) % LOOP;
      const ts0 = path.map((_, k) => offset + (k / STEPS) * 360);
      const ts = view === "globe" ? globeTimestamps(path, ts0) : ts0;
      // Second copy one loop earlier: a pulse still travelling when the clock wraps finishes instead of vanishing.
      tr.push({ path, timestamps: ts, color: rgb, width: w + 0.6 }, { path, timestamps: ts.map((x) => x - LOOP), color: rgb, width: w + 0.6 });
    }
    return { segments: segs, trips: tr };
  }, [geo, edges.data, maxV, view, colors]);

  const layers = useMemo(() => {
    if (!geo || !countries) return [];
    const col = (iso3: string): RGB => colors?.get(iso3) ?? GREY;
    const isGlobe = view === "globe";
    const dim = (...iso3s: string[]) => focus != null && !iso3s.includes(focus);
    const visible = [...traders.values()];
    const core = (iso3: string) => 2 + 6 * (traders.get(iso3)?.s ?? 0);
    // Greedy screen-space label placement: biggest traders first, chip to the right of the dot (else left).
    const ranked = [...visible].sort((a, b) => b.total - a.total).slice(0, 34);
    const placed: Placed[] = [];
    if (!isGlobe) {
      const vp = new WebMercatorViewport({ ...viewState, width: size.width, height: size.height });
      const boxes: [number, number, number, number][] = [];
      for (const t of ranked) {
        const [x, y] = vp.project(geo.anchor.get(t.n.iso3)!);
        const text = `${shortName(geo.names.get(t.n.iso3) ?? t.n.iso3)}  ${usd(t.total)}`;
        const w = text.length * 6.1 + 12, r = core(t.n.iso3) + 5;
        for (const left of [false, true]) {
          const box: [number, number, number, number] = left ? [x - r - w, y - 9, x - r, y + 9] : [x + r, y - 9, x + r + w, y + 9];
          if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
          boxes.push(box);
          placed.push({ n: t.n, text, color: col(t.n.iso3), left });
          break;
        }
        if (placed.length >= 18) break;
      }
    }
    const flowProps = {
      id: "flows",
      data: segments,
      getColor: (s: Segment): RGBA => (dim(s.edge.i, s.edge.e) ? [s.color[0], s.color[1], s.color[2], 5] : focus ? [s.color[0], s.color[1], s.color[2], Math.min(255, s.color[3] * 1.6)] : s.color),
      getWidth: (s: Segment) => s.width,
      widthUnits: "pixels" as const,
      pickable: true,
      parameters: ADDITIVE,
      updateTriggers: { getColor: focus },
    };
    return [
      new PathLayer<[number, number][]>({
        id: "grid",
        visible: !isGlobe,
        data: GRID_LINES,
        getPath: (p) => p,
        getColor: GRID,
        getWidth: 1,
        widthUnits: "pixels",
      }),
      new ScatterplotLayer<[number, number]>({
        id: "grid-dots",
        visible: !isGlobe,
        data: GRID_DOTS,
        getPosition: (p) => p,
        getRadius: 1.6,
        radiusUnits: "pixels",
        getFillColor: GRID_DOT,
      }),
      new GeoJsonLayer({
        id: "land",
        data: { ...countries, features: countries.features.filter((f) => f.id !== "010") }, // drop Antarctica
        wrapLongitude: !isGlobe,
        filled: true,
        stroked: true,
        getFillColor: LAND,
        getLineColor: BORDER,
        lineWidthMinPixels: 0.5,
        pickable: true,
      }),
      ...(glow && !isGlobe
        ? [new BitmapLayer({ id: "border-glow", image: glow, bounds: GLOW_BOUNDS, opacity: focus ? 0.45 : 1, parameters: ADDITIVE })]
        : []),
      // Crisp coloured outline on top of the glow; brighter for big traders, full strength on focus.
      new GeoJsonLayer({
        id: "trader-borders",
        data: { ...countries, features: countries.features.filter((f) => f.properties?.iso3 && traders.has(f.properties.iso3)) },
        wrapLongitude: !isGlobe,
        filled: false,
        stroked: true,
        getLineColor: (f) => {
          const iso3 = f.properties!.iso3!, s = traders.get(iso3)?.s ?? 0, c = col(iso3);
          return [c[0], c[1], c[2], iso3 === focus ? 255 : dim(iso3) ? 40 : Math.round(90 + 150 * s)];
        },
        getLineWidth: (f) => (f.properties!.iso3 === focus ? 2 : 0.8 + 0.8 * (traders.get(f.properties!.iso3!)?.s ?? 0)),
        lineWidthUnits: "pixels",
        updateTriggers: { getLineColor: [focus, traders, colors], getLineWidth: [focus, traders] },
      }),
      // Same segments either way; the globe draws them as two-point paths (LineLayer draws nothing on the globe).
      ...[isGlobe
        ? new PathLayer<Segment>({ ...flowProps, getPath: (s) => [s.from, s.to] })
        : new LineLayer<Segment>({ ...flowProps, getSourcePosition: (s) => s.from, getTargetPosition: (s) => s.to })],
      ...(animate
        ? [
            new TripsLayer<Trip>({
              id: "pulses",
              data: trips,
              getPath: (d) => d.path,
              getTimestamps: (d) => d.timestamps,
              getColor: (d) => d.color,
              opacity: focus ? 0.25 : 0.6,
              widthMinPixels: 1.4,
              getWidth: (d) => d.width,
              widthUnits: "pixels",
              trailLength: 230, // ~2/3 of a flow: the pulse sweeps most of the line
              currentTime: time,
              capRounded: true,
              fadeTrail: true,
              parameters: ADDITIVE,
            }),
          ]
        : []),
      new ScatterplotLayer<Trader>({
        id: "halo",
        data: visible,
        getPosition: (t) => geo.anchor.get(t.n.iso3)!,
        getRadius: (t) => core(t.n.iso3) * 3,
        radiusUnits: "pixels",
        getFillColor: (t) => [...col(t.n.iso3), dim(t.n.iso3) ? 8 : Math.round(25 + 35 * t.s)] as RGBA,
        parameters: ADDITIVE,
        updateTriggers: { getFillColor: [focus, colors] },
      }),
      new ScatterplotLayer<Trader>({
        id: "nodes",
        data: visible,
        getPosition: (t) => geo.anchor.get(t.n.iso3)!,
        getRadius: (t) => core(t.n.iso3),
        radiusUnits: "pixels",
        getFillColor: (t) => (t.n.iso3 === focus ? [255, 255, 255, 255] : ([...col(t.n.iso3), dim(t.n.iso3) ? 90 : 255] as RGBA)),
        stroked: true,
        getLineColor: [14, 21, 25, 255],
        lineWidthMinPixels: 1,
        pickable: true,
        updateTriggers: { getFillColor: [focus, colors] },
      }),
      new TextLayer<Placed>({
        id: "labels",
        visible: fontReady && !isGlobe,
        data: placed,
        getPosition: (p) => geo.anchor.get(p.n.iso3)!,
        getText: (p) => p.text,
        getSize: 11,
        getColor: (p) => (dim(p.n.iso3) ? [230, 236, 240, 90] : [236, 241, 244, 235]),
        getPixelOffset: (p) => [(p.left ? -1 : 1) * (core(p.n.iso3) + 6), 0],
        getTextAnchor: (p) => (p.left ? "end" : "start"),
        getAlignmentBaseline: "center",
        background: true,
        getBackgroundColor: [12, 18, 22, 215],
        getBorderColor: (p) => [...p.color, dim(p.n.iso3) ? 30 : 110] as RGBA,
        getBorderWidth: 1,
        backgroundPadding: [5, 2, 5, 2],
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        fontWeight: 500,
        characterSet: "auto",
        updateTriggers: { getColor: focus, getBorderColor: focus },
      }),
    ];
  }, [geo, countries, glow, segments, trips, traders, focus, animate, time, fontReady, view, viewState, size, colors]);

  const onHover = (p: PickingInfo) => {
    if (!p.object) return setHover(null);
    if (p.layer?.id === "flows") return setHover({ kind: "arc", x: p.x, y: p.y, edge: (p.object as Segment).edge });
    const iso3 = p.layer?.id === "nodes" ? (p.object as Trader).n.iso3 : (p.object as { properties?: { iso3?: string } }).properties?.iso3;
    setHover(iso3 ? { kind: "country", x: p.x, y: p.y, iso3 } : null);
  };
  const onClick = (p: PickingInfo) => {
    const o = p.object as (Trader & Segment & { properties?: { iso3?: string } }) | undefined;
    const iso3 = p.layer?.id === "nodes" ? o?.n.iso3 : p.layer?.id === "land" ? o?.properties?.iso3 : p.layer?.id === "flows" ? o?.edge.i : undefined;
    if (iso3) setSelected(iso3);
  };

  const basketLabel = info?.baskets.find((b) => b.id === basket)?.label ?? basket;
  const items = (info?.baskets ?? []).map((b) => ({ value: b.id, label: b.label }));
  // Colour key: the largest importers on the map (their colour is the colour of the flows arriving there).
  const topImporters = useMemo(() => {
    const byI = new Map<string, number>();
    for (const d of edges.data ?? []) byI.set(d.i, (byI.get(d.i) ?? 0) + d.v);
    return [...byI].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [edges.data]);

  const controls = (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        The {edges.data?.length ?? "…"} largest flows of {basketLabel.toLowerCase()} in {year ?? "…"}. Each country has its own colour, and every flow takes the colour of the country it arrives in.
      </p>
      <div className="space-y-1.5">
        <Label>Product basket</Label>
        <Select items={items} value={basket} onValueChange={(v) => v && setBasket(v as string)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectPopup>{items.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}</SelectPopup>
        </Select>
      </div>
      {info && year != null && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm"><Label>Year</Label><span className="text-foreground">{year}{info.provisional_years.includes(year) ? ", provisional" : ""}</span></div>
          <Slider aria-label="Year" min={info.years[0]} max={info.years.at(-1)} step={1} value={year} onValueChange={(v) => setYear(v as number)} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Largest importers on the map</Label>
        <ul className="-mx-1.5 space-y-0.5">
          {topImporters.map(([iso3, v]) => {
            const c = `rgb(${colorOf(iso3).join(",")})`;
            return (
              <li key={iso3}>
                <button
                  type="button"
                  onClick={() => setSelected(iso3)}
                  onMouseEnter={() => setKeyFocus(iso3)}
                  onMouseLeave={() => setKeyFocus(null)}
                  onFocus={() => setKeyFocus(iso3)}
                  onBlur={() => setKeyFocus(null)}
                  className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                  <span className="flex-1 truncate text-foreground">{shortName(geo?.names.get(iso3) ?? iso3)}</span>
                  <span className="tabular-nums text-muted-foreground">{usd(v)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">Imports carried by the flows drawn, not total imports. Hover a name to light up its flows.</p>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm"><Label>Flows drawn</Label><span className="text-foreground">{topN}</span></div>
        <Slider aria-label="Flows drawn" min={30} max={250} step={10} value={topN} onValueChange={(v) => setTopN(v as number)} />
      </div>
      <div className="space-y-1.5">
        <Label>Projection</Label>
        <ToggleGroup value={[view]} onValueChange={(v) => v[0] && setView(v[0] as "map" | "globe")} aria-label="Projection">
          <ToggleGroupItem value="map">Flat map</ToggleGroupItem>
          <ToggleGroupItem value="globe">Globe</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <label className="flex items-center justify-between text-sm">
        <span className="text-foreground">Animate flow direction</span>
        <Switch checked={animate} onCheckedChange={setAnimate} aria-label="Animate flow direction" />
      </label>
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Badge variant="outline">Observed</Badge>
        <Badge variant="outline">CEPII BACI {info?.source.hs_revision} V{info?.source.release}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Lines run from exporter to importer and brighten on arrival. Brighter borders mean bigger traders in this basket. Lines are statistical links between countries, not shipping routes.
      </p>
    </div>
  );

  const views = view === "globe" ? new GlobeView({ id: "globe", resolution: GLOBE_RESOLUTION }) : new MapView({ id: "map", repeat: false });

  return (
    <div className="relative h-svh w-full overflow-hidden" style={{ background: SEA }}>
      <DeckGL
        views={views}
        {...(view === "globe"
          ? { initialViewState: { longitude: 70, latitude: 22, zoom: 0.95 } }
          : { viewState, onViewStateChange: ({ viewState: v }: { viewState: MapViewState }) => setViewState(v as MapViewState) })}
        onResize={(d: { width: number; height: number }) => setSize(d)}
        controller={{ dragRotate: false }}
        layers={layers}
        onHover={onHover}
        onClick={onClick}
        pickingRadius={4}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
        style={{ position: "absolute", inset: "0" }}
        key={view}
      />
      {/* Vignette: darkens the frame edges so the eye settles on the lit countries. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: VIGNETTE }} />
      <SidebarPanel title="Trade map">{controls}</SidebarPanel>
      {hover && geo && year != null && <HoverCard hover={hover} basket={basket} year={year} names={geo.names} />}
      <CountrySheet iso3={selected} basket={basket} basketLabel={basketLabel} year={year} names={geo?.names} onClose={() => setSelected(null)} />
    </div>
  );
}
