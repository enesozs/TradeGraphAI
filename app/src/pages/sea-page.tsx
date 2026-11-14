import { MapView, WebMercatorViewport, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { BitmapLayer, GeoJsonLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Swatch } from "@/components/page";
import { CardRow, PointerCard } from "@/components/pointer-card";
import { SidebarPanel } from "@/components/sidebar-panel";
import { TrafficChart, type TrafficRow } from "@/components/traffic-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GLOW_BOUNDS, paintBorderGlow, type GlowSpec } from "@/lib/border-glow";
import { useCountryColors, type RGB } from "@/lib/country-colors";
import { useJson, useQuery } from "@/lib/db";
import { countryName, km, pct, tonnes, usd } from "@/lib/format";
import { useGeo } from "@/lib/geo";
import { ADDITIVE, BORDER, CHIP, GRID, GRID_DOT, GRID_DOTS, GRID_LINES, LAND, SEA, VIGNETTE, placeChip, type Box, type RGBA } from "@/lib/map-style";
import { latestFinalYear, useBuildInfo } from "@/lib/meta";

type Lane = { id: number; path: [number, number][]; chokepoints: string[] };
type Piece = { id: number; path: [number, number][]; load: number; delta: number; chokepoints: string[] };
type Load = { edge_id: number; scenario: string; tonnes: number | null; value_kusd: number | null };
type Choke = { key: string; name: string; lat: number; lon: number; modelled: boolean; closable: boolean };
type Exposure = { chokepoint: string; tonnes: number | null; value_kusd: number; pairs: number; world_t: number | null; world_kusd: number };
type Mode = { mode_class: string; tonnes: number | null; value_kusd: number };
type SeaInfo = { closure_year: number; portwatch: { attribution: string; transformation: string; first_date: string; last_date: string }; chokepoint_names: Record<string, string> };
type Measure = "tonnes" | "value";
type Hover = { x: number; y: number; lane?: Piece; choke?: Choke } | null;
// An importer's reliance on one chokepoint: the amount of its imports routed through it, and its total imports.
type Reliance = { importer_iso3: string; chokepoint: string; amount: number; imports: number };
type Chip = { pos: [number, number]; text: string; side: "start" | "end"; offset: number; color: RGBA; border: RGBA };

const SCEN = [243, 167, 18] as const; // --tg-scenario: load added by a closure
const WARN = [255, 92, 72] as const; // the closed chokepoint
const GREY: RGB = [124, 143, 161];
const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MODE_LABEL: Record<string, string> = {
  sea: "Modelled sea route",
  neighbour: "Neighbours (assumed overland)",
  overland_detour: "Close by land (assumed overland)",
  no_port: "Landlocked or no seaport",
  no_route: "No sea connection",
  eu_not_sea: "EU imports by air, road or rail (observed)",
};

// Lane light ramp: quiet deep teal for thin traffic, cyan for busy lanes, near-white for the main corridors.
function laneColor(t: number, alpha: number): RGBA {
  const stops: [number, RGB][] = [[0, [22, 92, 112]], [0.45, [56, 196, 232]], [1, [232, 250, 255]]];
  const k = t <= stops[1][0] ? 0 : 1;
  const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u, alpha].map(Math.round) as RGBA;
}

// Split a lon/lat path where it crosses the antimeridian so no segment spans the whole map.
function splitAntimeridian(path: [number, number][]): [number, number][][] {
  const out: [number, number][][] = [[path[0]]];
  for (let k = 1; k < path.length; k++) {
    if (Math.abs(path[k][0] - path[k - 1][0]) > 180) out.push([]);
    out.at(-1)!.push(path[k]);
  }
  return out.filter((p) => p.length > 1);
}

const shortName = (s: string) =>
  s.replace(" (Other Asia, nes)", "").replace("Rep. of Korea", "Korea").replace("China, Hong Kong SAR", "Hong Kong").replace("Viet Nam", "Vietnam").replace("United Kingdom", "UK").replace("United States of America", "USA");
const shortChoke = (s: string) => s.replace(/^Strait of /, "").replace(/ Strait$/, "").replace(/ Canal$/, "");
// Ties are common (an Asia-Europe route passes Malacca, Bab el-Mandeb, Suez and Gibraltar with the same load):
// among passages carrying at least 90% of an importer's largest amount, name the most constraining one
// (so "via Suez" rather than "via Gibraltar"), with that passage's own amount.
const PRIORITY = ["suez", "bab_el_mandeb", "hormuz", "panama", "turkish_straits", "malacca", "sunda", "bering", "gibraltar", "cape_of_good_hope", "cape_horn_magellan"];
const PRIO_SQL = `CASE chokepoint ${PRIORITY.map((k, i) => `WHEN '${k}' THEN ${PRIORITY.length - i}`).join(" ")} ELSE 0 END`;
const GLOWN = 22; // countries lit at once: the most reliant by amount

export function SeaPage() {
  const info = useBuildInfo();
  const sea = useJson<SeaInfo>("sea_info.json");
  const lanes = useJson<Lane[]>("sea_lanes.json");
  const geo = useGeo();
  const colors = useCountryColors();
  const [basket, setBasket] = useState("li_ion_batteries");
  const [year, setYear] = useState<number | null>(null);
  const [measure, setMeasure] = useState<Measure>("tonnes");
  const [closed, setClosed] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [viewState, setViewState] = useState<MapViewState>({ longitude: 45, latitude: 18, zoom: 1.5, minZoom: 1, maxZoom: 7 });
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [fontReady, setFontReady] = useState(false);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    document.fonts.load('500 11px "Archivo Variable"').then(() => setFontReady(true));
  }, []);
  useEffect(() => {
    if (info && year == null) setYear(latestFinalYear(info));
  }, [info, year]);
  // Slow breathing ring on the three busiest chokepoints (the one moving element; off for reduced motion).
  useEffect(() => {
    if (reducedMotion) return;
    let raf = 0;
    const tick = () => {
      setPulse((performance.now() / 2600) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const y = closed && sea ? sea.closure_year : year;
  const fmt = measure === "tonnes" ? tonnes : usd;
  const focusKey = closed ?? selected; // the chokepoint whose dependants the map lights up

  const loads = useQuery<Load>(
    `SELECT edge_id, scenario, tonnes, value_kusd FROM sea_lane_load WHERE basket_id = ? AND year = ? AND scenario IN ('base', ?)`,
    [basket, y, closed ?? "base"],
  );
  const chokes = useQuery<Choke>(`SELECT key, name, lat, lon, modelled, closable FROM chokepoints`);
  const exposure = useQuery<Exposure>(`SELECT chokepoint, tonnes, value_kusd, pairs, world_t, world_kusd FROM chokepoint_exposure WHERE basket_id = ? AND year = ?`, [basket, y]);
  const modes = useQuery<Mode>(`SELECT mode_class, tonnes, value_kusd FROM sea_mode_summary WHERE basket_id = ? AND year = ?`, [basket, y]);
  const [amt, imp] = measure === "tonnes" ? ["tonnes", "imports_t"] : ["value_kusd", "imports_kusd"];
  // Without a focus: each importer's most-relied-on chokepoint. With one: every importer routed through it.
  const reliance = useQuery<Reliance>(
    focusKey
      ? `SELECT importer_iso3, chokepoint, ${amt} AS amount, ${imp} AS imports FROM chokepoint_importer
         WHERE basket_id = ? AND year = ? AND chokepoint = ? AND ${amt} > 0`
      : `WITH r AS (
           SELECT importer_iso3, chokepoint, ${amt} AS amt, ${imp} AS imports, ${PRIO_SQL} AS prio,
                  max(${amt}) OVER (PARTITION BY importer_iso3) AS mx
           FROM chokepoint_importer WHERE basket_id = ? AND year = ? AND ${amt} > 0)
         SELECT importer_iso3, arg_max(chokepoint, prio) AS chokepoint, arg_max(amt, prio) AS amount, any_value(imports) AS imports
         FROM r WHERE amt >= 0.9 * mx GROUP BY importer_iso3`,
    focusKey ? [basket, y, focusKey] : [basket, y],
  );

  const expOf = useMemo(() => new Map((exposure.data ?? []).map((e) => [e.chokepoint, e])), [exposure.data]);
  const world = useMemo(() => {
    const m = modes.data ?? [];
    return { t: m.reduce((s, r) => s + (r.tonnes ?? 0), 0), v: m.reduce((s, r) => s + r.value_kusd, 0) };
  }, [modes.data]);
  const share = (e?: Exposure) => (e ? (measure === "tonnes" ? (e.tonnes ?? 0) / (world.t || 1) : e.value_kusd / (world.v || 1)) : 0);
  const amount = (e?: Exposure) => (e ? (measure === "tonnes" ? e.tonnes : e.value_kusd) : null);
  const nameOf = (k: string) => (chokes.data ?? []).find((c) => c.key === k)?.name ?? sea?.chokepoint_names[k] ?? k;
  const colorOf = (iso3: string): RGB => colors?.get(iso3) ?? GREY;

  // Importers ranked by the amount riding on one chokepoint: brightness follows that amount (big AND reliant).
  const reliant = useMemo(() => {
    const rows = (reliance.data ?? []).filter((r) => geo?.anchor.has(r.importer_iso3)).sort((a, b) => b.amount - a.amount);
    const max = rows[0]?.amount || 1;
    return rows.map((r) => ({ ...r, s: Math.sqrt(r.amount / max), share: r.amount / (r.imports || 1) }));
  }, [reliance.data, geo]);
  const glow = useMemo(() => {
    if (!geo || !colors || reliant.length === 0) return null;
    const spec = new Map<string, GlowSpec>(reliant.slice(0, GLOWN).map((r) => [r.importer_iso3, { color: colors.get(r.importer_iso3) ?? GREY, strength: r.s }]));
    return paintBorderGlow(geo.countries, spec);
  }, [geo, colors, reliant]);

  const pieces = useMemo(() => {
    if (!lanes || !loads.data) return [] as Piece[];
    const base = new Map<number, number>(), scen = new Map<number, number>();
    for (const l of loads.data) (l.scenario === "base" ? base : scen).set(l.edge_id, (measure === "tonnes" ? l.tonnes : l.value_kusd) ?? 0);
    const out: Piece[] = [];
    for (const lane of lanes) {
      const b = base.get(lane.id) ?? 0;
      const load = closed ? scen.get(lane.id) ?? 0 : b;
      if (load <= 0 && b <= 0) continue;
      for (const path of splitAntimeridian(lane.path)) out.push({ id: lane.id, path, load, delta: closed ? load - b : 0, chokepoints: lane.chokepoints });
    }
    return out.sort((a, b) => a.load - b.load); // brightest lanes drawn last
  }, [lanes, loads.data, closed, measure]);
  const maxLoad = useMemo(() => Math.max(1, ...pieces.map((p) => p.load)), [pieces]);
  const maxExp = useMemo(() => Math.max(1e-9, ...(exposure.data ?? []).map((e) => share(e))), [exposure.data, measure, world]); // eslint-disable-line react-hooks/exhaustive-deps
  const ranked = useMemo(
    () => (chokes.data ?? []).filter((c) => c.modelled && expOf.has(c.key)).sort((a, b) => share(expOf.get(b.key)) - share(expOf.get(a.key))),
    [chokes.data, expOf, measure, world], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const top3 = useMemo(() => new Set(ranked.slice(0, 3).map((c) => c.key)), [ranked]);
  const r = (c: Choke) => (c.modelled ? 3.5 + 9 * Math.sqrt(share(expOf.get(c.key)) / maxExp) : 2.4);

  // Static layers: everything except the breathing ring.
  const layers = useMemo(() => {
    if (!geo) return [];
    const all = chokes.data ?? [];
    const vp = new WebMercatorViewport({ ...viewState, width: size.width, height: size.height });
    const boxes: Box[] = [];
    const chips: Chip[] = [];
    // Chokepoints first (they matter most), then the most reliant importers.
    for (const c of ranked) {
      const [px, py] = vp.project([c.lon, c.lat]);
      const s = share(expOf.get(c.key));
      const text = c.key === closed ? `${shortChoke(c.name)} closed` : `${shortChoke(c.name)}  ${pct(s, 0)}`;
      const side = placeChip(boxes, px, py, r(c) + 5, text);
      if (side) chips.push({ pos: [c.lon, c.lat], text, side, offset: r(c) + 6, color: [236, 241, 244, 240], border: c.key === closed ? [WARN[0], WARN[1], WARN[2], 220] : [232, 250, 255, 120] });
    }
    let n = 0;
    for (const t of reliant) {
      if (n >= 10) break;
      const a = geo.anchor.get(t.importer_iso3)!;
      const [px, py] = vp.project(a);
      const name = shortName(geo.names.get(t.importer_iso3) ?? t.importer_iso3);
      const text = focusKey ? `${name}  ${pct(t.share, 0)}` : `${name}  ${pct(t.share, 0)} via ${shortChoke(nameOf(t.chokepoint))}`;
      const side = placeChip(boxes, px, py, 6, text);
      if (!side) continue;
      n++;
      const c = colorOf(t.importer_iso3);
      chips.push({ pos: a, text, side, offset: 6, color: [220, 228, 234, Math.round(150 + 90 * t.s)], border: [c[0], c[1], c[2], Math.round(60 + 100 * t.s)] });
    }
    const tw = (p: Piece) => Math.sqrt(p.load / maxLoad);
    return [
      new PathLayer<[number, number][]>({ id: "grid", data: GRID_LINES, getPath: (p) => p, getColor: GRID, getWidth: 1, widthUnits: "pixels" }),
      new ScatterplotLayer<[number, number]>({ id: "grid-dots", data: GRID_DOTS, getPosition: (p) => p, getRadius: 1.6, radiusUnits: "pixels", getFillColor: GRID_DOT }),
      new GeoJsonLayer({
        id: "land",
        data: { ...geo.countries, features: geo.countries.features.filter((f) => f.id !== "010") },
        wrapLongitude: true, filled: true, stroked: true, getFillColor: LAND, getLineColor: BORDER, lineWidthMinPixels: 0.5,
      }),
      ...(glow ? [new BitmapLayer({ id: "importer-glow", image: glow, bounds: GLOW_BOUNDS, parameters: ADDITIVE })] : []),
      new GeoJsonLayer({
        id: "importer-borders",
        data: { ...geo.countries, features: geo.countries.features.filter((f) => f.properties?.iso3 && reliant.slice(0, GLOWN).some((t) => t.importer_iso3 === f.properties!.iso3)) },
        wrapLongitude: true, filled: false, stroked: true, lineWidthUnits: "pixels",
        getLineColor: (f) => {
          const t = reliant.find((x) => x.importer_iso3 === f.properties!.iso3), c = colorOf(f.properties!.iso3!);
          return [c[0], c[1], c[2], Math.round(70 + 170 * (t?.s ?? 0))];
        },
        getLineWidth: (f) => 0.7 + 0.9 * (reliant.find((x) => x.importer_iso3 === f.properties!.iso3)?.s ?? 0),
        updateTriggers: { getLineColor: [reliant, colors], getLineWidth: reliant },
      }),
      // Soft light under the main corridors, then the lanes themselves on the teal-to-white ramp.
      new PathLayer<Piece>({
        id: "lane-glow",
        data: pieces.filter((p) => tw(p) > 0.25),
        getPath: (p) => p.path,
        getWidth: (p) => 4 + 14 * tw(p),
        widthUnits: "pixels",
        getColor: (p) => laneColor(tw(p), Math.round(10 + 26 * tw(p))),
        capRounded: true, jointRounded: true, parameters: ADDITIVE,
      }),
      new PathLayer<Piece>({
        id: "lanes",
        data: pieces.filter((p) => p.load > 0),
        getPath: (p) => p.path,
        getWidth: (p) => 0.6 + 4.6 * tw(p),
        widthUnits: "pixels",
        getColor: (p) => laneColor(tw(p), Math.round(70 + 170 * tw(p))),
        capRounded: true, jointRounded: true, pickable: true, parameters: ADDITIVE,
      }),
      ...(closed
        ? [
            new PathLayer<Piece>({
              id: "added-glow",
              data: pieces.filter((p) => p.delta > 0),
              getPath: (p) => p.path,
              getWidth: (p) => 5 + 14 * Math.sqrt(p.delta / maxLoad),
              widthUnits: "pixels",
              getColor: [SCEN[0], SCEN[1], SCEN[2], 34],
              capRounded: true, jointRounded: true, parameters: ADDITIVE,
            }),
            new PathLayer<Piece>({
              id: "added",
              data: pieces.filter((p) => p.delta > 0),
              getPath: (p) => p.path,
              getWidth: (p) => 0.8 + 4.6 * Math.sqrt(p.delta / maxLoad),
              widthUnits: "pixels",
              getColor: (p) => [SCEN[0], SCEN[1], SCEN[2], Math.round(110 + 140 * Math.sqrt(p.delta / maxLoad))],
              capRounded: true, jointRounded: true, pickable: true, parameters: ADDITIVE,
            }),
          ]
        : []),
      new ScatterplotLayer<Choke>({
        id: "choke-halo",
        data: all.filter((c) => c.modelled),
        getPosition: (c) => [c.lon, c.lat],
        getRadius: (c) => r(c) * 3.2,
        radiusUnits: "pixels",
        getFillColor: (c) => (c.key === closed ? [WARN[0], WARN[1], WARN[2], 70] : [210, 245, 255, c.key === selected ? 60 : 26]),
        parameters: ADDITIVE,
        updateTriggers: { getFillColor: [closed, selected], getRadius: [measure, basket, y] },
      }),
      new ScatterplotLayer<Choke>({
        id: "chokepoints",
        data: all,
        getPosition: (c) => [c.lon, c.lat],
        getRadius: (c) => r(c),
        radiusUnits: "pixels",
        stroked: true,
        filled: true,
        lineWidthUnits: "pixels",
        getLineWidth: (c) => (c.modelled ? (c.key === selected ? 2.5 : 1.2) : 1),
        getLineColor: (c) => (c.key === closed ? [255, 210, 200, 255] : c.modelled ? [14, 21, 25, 255] : [147, 168, 186, 150]),
        getFillColor: (c) => (c.key === closed ? [WARN[0], WARN[1], WARN[2], 255] : c.modelled ? [240, 252, 255, 255] : [14, 21, 25, 255]),
        pickable: true,
        updateTriggers: { getFillColor: closed, getLineWidth: selected, getLineColor: closed, getRadius: [measure, basket, y] },
      }),
      new TextLayer<Chip>({
        id: "chips",
        visible: fontReady,
        data: chips,
        ...CHIP,
        getPosition: (d) => d.pos,
        getText: (d) => d.text,
        getColor: (d) => d.color,
        getBorderColor: (d) => d.border,
        getPixelOffset: (d) => [d.side === "start" ? d.offset : -d.offset, 0],
        getTextAnchor: (d) => d.side,
        getAlignmentBaseline: "center",
      }),
    ];
  }, [geo, glow, reliant, pieces, maxLoad, chokes.data, expOf, maxExp, ranked, closed, selected, focusKey, viewState, size, fontReady, measure, basket, y, colors]); // eslint-disable-line react-hooks/exhaustive-deps

  // The breathing ring: an expanding, fading circle on the top three chokepoints.
  const pulseLayer = useMemo(() => {
    if (reducedMotion || closed) return null;
    const data = (chokes.data ?? []).filter((c) => top3.has(c.key));
    return new ScatterplotLayer<Choke>({
      id: "choke-pulse",
      data,
      getPosition: (c) => [c.lon, c.lat],
      getRadius: (c) => r(c) * (1.2 + 2.6 * pulse),
      radiusUnits: "pixels",
      filled: false,
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.5,
      getLineColor: [220, 248, 255, Math.round(170 * (1 - pulse))],
      parameters: ADDITIVE,
      updateTriggers: { getRadius: pulse, getLineColor: pulse },
    });
  }, [pulse, chokes.data, top3, closed]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHover = (p: PickingInfo) => {
    if (!p.object) return setHover(null);
    if (p.layer?.id === "chokepoints") return setHover({ x: p.x, y: p.y, choke: p.object as Choke });
    setHover({ x: p.x, y: p.y, lane: p.object as Piece });
  };
  const onClick = (p: PickingInfo) => {
    if (p.layer?.id === "chokepoints") setSelected((p.object as Choke).key);
  };

  const basketLabel = info?.baskets.find((b) => b.id === basket)?.label ?? basket;
  const items = (info?.baskets ?? []).map((b) => ({ value: b.id, label: b.label }));
  const closable = (chokes.data ?? []).filter((c) => c.closable);
  const closeItems = [{ value: "none", label: "None (observed routes)" }, ...closable.map((c) => ({ value: c.key, label: c.name }))];
  const usdPerKg = world.t > 0 ? (world.v * 1e3) / (world.t * 1e3) : null;
  const seaShare = (modes.data ?? []).find((m) => m.mode_class === "sea");

  const controls = (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Modelled sea lanes carrying {basketLabel.toLowerCase()} in {y ?? "…"}. The brightest lanes carry the most; glowing countries rely most on a single chokepoint. Click a chokepoint for its traffic and dependants.
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
          <div className="flex justify-between text-sm"><Label>Year</Label><span className="text-foreground">{y}{info.provisional_years.includes(y!) ? ", provisional" : ""}</span></div>
          <Slider aria-label="Year" disabled={closed != null} min={info.years[0]} max={info.years.at(-1)} step={1} value={y!} onValueChange={(v) => setYear(v as number)} />
          {closed && <p className="text-xs text-muted-foreground">Closure scenarios use {sea?.closure_year}, the latest final year.</p>}
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Measure</Label>
        <ToggleGroup value={[measure]} onValueChange={(v) => v[0] && setMeasure(v[0] as Measure)} aria-label="Measure">
          <ToggleGroupItem value="tonnes">Tonnes</ToggleGroupItem>
          <ToggleGroupItem value="value">Value (USD)</ToggleGroupItem>
        </ToggleGroup>
        {usdPerKg != null && usdPerKg > 100 && (
          <p className="text-xs text-[var(--tg-scenario)]">About ${usdPerKg.toFixed(0)} per kg: much of this basket flies. Read the tonnes view; value exposure by sea is overstated.</p>
        )}
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Share of world trade through each chokepoint</h3>
        <ul className="space-y-1">
          {ranked.map((c) => {
            const e = expOf.get(c.key);
            return (
              <li key={c.key}>
                <button type="button" onClick={() => setSelected(c.key)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-2 rounded px-1 py-0.5 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                  <span className={c.key === selected ? "font-medium text-foreground" : "text-foreground"}>{c.name}</span>
                  <span className="text-foreground tabular-nums">{pct(share(e), 0)}</span>
                  <span className="col-span-2 h-1 overflow-hidden rounded bg-[var(--tg-slate)]">
                    <span className="block h-full rounded" style={{ width: `${Math.max(1, share(e) * 100)}%`, background: "linear-gradient(90deg, rgb(22,92,112), rgb(56,196,232), rgb(232,250,255))", boxShadow: "0 0 6px rgba(56,196,232,0.6)" }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Denominator: all {basketLabel.toLowerCase()} trade in {y}, every partner and mode ({fmt(measure === "tonnes" ? world.t : world.v)}). Modelled by sea: {pct(seaShare ? (measure === "tonnes" ? (seaShare.tonnes ?? 0) / (world.t || 1) : seaShare.value_kusd / (world.v || 1)) : null, 0)}.
        </p>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground">How trade was split by mode</summary>
          <dl className="mt-1.5 space-y-1">
            {(modes.data ?? []).toSorted((a, b) => b.value_kusd - a.value_kusd).map((m) => (
              <CardRow key={m.mode_class} label={MODE_LABEL[m.mode_class] ?? m.mode_class} value={pct(measure === "tonnes" ? (m.tonnes ?? 0) / (world.t || 1) : m.value_kusd / (world.v || 1), 0)} />
            ))}
          </dl>
        </details>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{focusKey ? `Who relies on ${nameOf(focusKey)}` : "Most reliant on one chokepoint"}</h3>
        <ul className="space-y-0.5">
          {reliant.slice(0, 8).map((t) => {
            const c = `rgb(${colorOf(t.importer_iso3).join(",")})`;
            return (
              <li key={t.importer_iso3} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 px-1 py-0.5 text-sm">
                <Swatch color={c} />
                <span className="truncate text-foreground">{shortName(geo?.names.get(t.importer_iso3) ?? t.importer_iso3)}</span>
                <span className="tabular-nums text-foreground">{pct(t.share, 0)}</span>
                <span />
                <span className="col-span-2 text-xs text-muted-foreground">{fmt(t.amount)}{focusKey ? "" : ` via ${nameOf(t.chokepoint)}`}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">Share of each country's {basketLabel.toLowerCase()} imports routed through {focusKey ? "this chokepoint" : "its most-used chokepoint"}. Ranked and lit by amount, so large importers stand out.</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Close a chokepoint</h3>
        <Select items={closeItems} value={closed ?? "none"} onValueChange={(v) => setClosed(!v || v === "none" ? null : (v as string))}>
          <SelectTrigger className="w-full" aria-label="Close a chokepoint"><SelectValue /></SelectTrigger>
          <SelectPopup>{closeItems.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}</SelectPopup>
        </Select>
        {closed && <ClosureSummary basket={basket} closed={closed} name={nameOf(closed)} measure={measure} world={world} names={geo?.names} />}
      </section>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">Model</Badge>
        {closed && <Badge variant="outline" className="border-[var(--tg-scenario)] text-[var(--tg-scenario)]">Scenario</Badge>}
        <Badge variant="outline">CEPII BACI {info?.source.hs_revision} V{info?.source.release}</Badge>
        <Badge variant="outline">IMF PortWatch</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Routes are modelled: each country pair's shortest path between its main ports (searoute, Eurostat MARNET). They are not ship tracks. Neighbouring and landlocked countries are treated as overland. For EU importers, only the share Eurostat records as arriving by sea is routed; the rest (air, road, rail) is left off the lanes. Other importers' trade is assumed to go by sea, which overstates sea exposure for goods that fly. {sea?.portwatch.attribution}
      </p>
    </div>
  );

  return (
    <div className="relative h-svh w-full overflow-hidden" style={{ background: SEA }}>
      <DeckGL
        views={new MapView({ id: "map", repeat: false })}
        viewState={viewState}
        onViewStateChange={({ viewState: v }) => setViewState(v as MapViewState)}
        onResize={(d: { width: number; height: number }) => setSize(d)}
        controller={{ dragRotate: false }}
        layers={pulseLayer ? [...layers.slice(0, -1), pulseLayer, layers.at(-1)!] : layers}
        onHover={onHover}
        onClick={onClick}
        pickingRadius={5}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
        style={{ position: "absolute", inset: "0" }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: VIGNETTE }} />
      <SidebarPanel title="Sea routes">{controls}</SidebarPanel>
      {closed && (
        <div className="pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-md border border-[var(--tg-scenario)]/50 bg-popover/90 px-3 py-1.5 text-sm text-foreground shadow-lg">
          Scenario: {nameOf(closed)} closed. <span className="text-[var(--tg-scenario)]">Amber</span> lanes carry rerouted trade.
        </div>
      )}
      {hover && (
        <PointerCard x={hover.x} y={hover.y}>
          {hover.choke ? (
            <ChokeCard c={hover.choke} e={expOf.get(hover.choke.key)} share={share(expOf.get(hover.choke.key))} amount={amount(expOf.get(hover.choke.key))} fmt={fmt} basketLabel={basketLabel} />
          ) : hover.lane ? (
            <>
              <p className="font-medium text-foreground">{closed && hover.lane.delta > 0 ? "Lane with rerouted trade" : "Sea lane"}</p>
              <p className="figure mt-2 text-2xl text-foreground">{fmt(hover.lane.load)}</p>
              <p className="text-muted-foreground">of {basketLabel.toLowerCase()} on this stretch in {y}</p>
              {closed && hover.lane.delta !== 0 && <p className="mt-2 text-foreground">{hover.lane.delta > 0 ? "+" : "−"}{fmt(Math.abs(hover.lane.delta))} versus open routes</p>}
              {hover.lane.chokepoints.length > 0 && <p className="mt-2 text-muted-foreground">Passes {hover.lane.chokepoints.map(nameOf).join(", ")}</p>}
            </>
          ) : null}
        </PointerCard>
      )}
      {selected && (
        <ChokeDrawer
          key={selected}
          choke={(chokes.data ?? []).find((c) => c.key === selected)}
          basket={basket}
          basketLabel={basketLabel}
          year={y!}
          measure={measure}
          closed={closed}
          onClose={() => setSelected(null)}
          onCloseChoke={(k) => setClosed(k)}
          sea={sea}
          names={geo?.names}
        />
      )}
    </div>
  );
}

function ChokeCard({ c, e, share, amount, fmt, basketLabel }: { c: Choke; e?: Exposure; share: number; amount: number | null; fmt: (x: number | null) => string; basketLabel: string }) {
  return (
    <>
      <p className="font-medium text-foreground">{c.name}</p>
      {!c.modelled ? (
        <p className="mt-2 text-muted-foreground">Not a passage in the route model. Click for observed ship traffic.</p>
      ) : !e ? (
        <p className="mt-2 text-muted-foreground">No modelled {basketLabel.toLowerCase()} trade passes here.</p>
      ) : (
        <>
          <p className="figure mt-2 text-2xl text-foreground">{pct(share, 1)}</p>
          <p className="text-muted-foreground">of world {basketLabel.toLowerCase()} trade passes here</p>
          <dl className="mt-3 space-y-1.5">
            <CardRow label="Through this chokepoint" value={fmt(amount)} strong />
            <CardRow label="Country pairs routed here" value={String(e.pairs)} />
          </dl>
        </>
      )}
    </>
  );
}

type ClosureRow = { importer_iso3: string; affected: number | null; no_route: number | null; extra_km: number | null; imports: number | null };

function ClosureSummary({ basket, closed, name, measure, world, names }: {
  basket: string; closed: string; name: string; measure: Measure; world: { t: number; v: number }; names?: Map<string, string>;
}) {
  const [a, n, imp] = measure === "tonnes" ? ["tonnes_affected", "tonnes_no_route", "imports_t"] : ["value_affected_kusd", "value_no_route_kusd", "imports_kusd"];
  const rows = useQuery<ClosureRow>(
    `SELECT importer_iso3, ${a} AS affected, ${n} AS no_route, extra_km_tonne_weighted AS extra_km, ${imp} AS imports
     FROM chokepoint_closure WHERE basket_id = ? AND closed = ? ORDER BY ${a} DESC NULLS LAST`,
    [basket, closed],
  );
  const fmt = measure === "tonnes" ? tonnes : usd;
  const all = rows.data ?? [];
  const affected = all.reduce((s, r) => s + (r.affected ?? 0), 0);
  const cut = all.reduce((s, r) => s + (r.no_route ?? 0), 0);
  const rerouted = all.reduce((s, r) => s + ((r.affected ?? 0) - (r.no_route ?? 0)), 0);
  const extra = rerouted > 0 ? all.reduce((s, r) => s + (r.extra_km ?? 0) * ((r.affected ?? 0) - (r.no_route ?? 0)), 0) / rerouted : null;
  const denom = measure === "tonnes" ? world.t : world.v;
  const name_ = (c: string) => names?.get(c) ?? countryName(c);
  if (rows.loading) return <p className="text-sm text-muted-foreground">Computing…</p>;
  return (
    <div className="space-y-3 rounded-md border border-[var(--tg-scenario)]/40 p-3">
      <dl className="space-y-1.5 text-sm">
        <CardRow label="Trade that used it" value={`${fmt(affected)} (${pct(affected / (denom || 1), 0)})`} strong />
        <CardRow label="Rerouted, extra distance" value={extra != null ? `+${km(extra)}` : "–"} />
        <CardRow label="No sea route left" value={cut > 0 ? fmt(cut) : "none"} />
      </dl>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Most affected importers (share of their imports)</p>
        <ul className="space-y-1 text-sm">
          {all.slice(0, 6).map((r) => (
            <li key={r.importer_iso3} className="grid grid-cols-[1fr_auto] gap-x-2">
              <span className="truncate text-foreground">{name_(r.importer_iso3)}</span>
              <span className="text-foreground tabular-nums">{pct((r.affected ?? 0) / (r.imports || 1), 0)}</span>
              <span className="col-span-2 text-xs text-muted-foreground">
                {fmt(r.affected)}{(r.no_route ?? 0) > 0 ? `, ${fmt(r.no_route)} with no sea route` : r.extra_km != null ? `, +${km(r.extra_km)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">Scenario: {name} closed to all shipping in the model. Ships take the next-shortest path by distance, which may differ from what carriers choose (e.g. via Panama rather than the Cape). No costs, delays, prices or demand response.</p>
    </div>
  );
}

type ImporterRow = { importer_iso3: string; amount: number | null; imports: number | null };

function ChokeDrawer({ choke, basket, basketLabel, year, measure, closed, onClose, onCloseChoke, sea, names }: {
  choke?: Choke; basket: string; basketLabel: string; year: number; measure: Measure; closed: string | null;
  onClose: () => void; onCloseChoke: (k: string | null) => void; sea: SeaInfo | null; names?: Map<string, string>;
}) {
  const traffic = useQuery<{ week: number; n_total: number }>(`SELECT epoch_ms(week) AS week, n_total FROM chokepoint_traffic WHERE key = ? ORDER BY week`, [choke?.key ?? ""]);
  const [a, imp] = measure === "tonnes" ? ["tonnes", "imports_t"] : ["value_kusd", "imports_kusd"];
  const importers = useQuery<ImporterRow>(
    `SELECT importer_iso3, ${a} AS amount, ${imp} AS imports FROM chokepoint_importer
     WHERE basket_id = ? AND year = ? AND chokepoint = ? ORDER BY ${a} DESC NULLS LAST LIMIT 6`,
    [basket, year, choke?.key ?? ""],
  );
  const colors = useCountryColors();
  const rows: TrafficRow[] = useMemo(() => (traffic.data ?? []).map((r) => ({ week: new Date(r.week), n_total: r.n_total })), [traffic.data]);
  if (!choke) return null;
  const fmt = measure === "tonnes" ? tonnes : usd;
  const name = (c: string) => names?.get(c) ?? countryName(c);
  const tint = (iso3: string) => `rgb(${(colors?.get(iso3) ?? GREY).join(",")})`;
  return (
    <section aria-label={`${choke.name} details`} className="absolute right-4 bottom-4 left-4 z-10 max-h-[46svh] overflow-auto rounded-lg border bg-popover/95 p-4 shadow-2xl backdrop-blur md:left-auto md:w-[min(920px,calc(100%-2rem))]">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{choke.name}</h2>
          <p className="text-sm text-muted-foreground">{choke.modelled ? "Passage in the route model" : "Observed traffic only; not a passage in the route model"}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close details" onClick={onClose}><XIcon /></Button>
      </div>
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium text-foreground">Ships per day, weekly average</h3>
            <Badge variant="outline">Observed</Badge>
          </div>
          {rows.length > 0 ? <TrafficChart rows={rows} /> : <p className="py-8 text-sm text-muted-foreground">Loading…</p>}
          <p className="text-xs text-muted-foreground">
            All vessel types, {sea?.portwatch.first_date} to {sea?.portwatch.last_date} (weeks starting). {sea?.portwatch.attribution} {sea?.portwatch.transformation}
          </p>
        </div>
        <div className="space-y-3">
          {choke.modelled ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">Importers whose {basketLabel.toLowerCase()} pass here</h3>
                <Badge variant="outline">Model</Badge>
              </div>
              {(importers.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No modelled trade of this basket passes here in {year}.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {(importers.data ?? []).map((r) => {
                    const s = (r.amount ?? 0) / (r.imports || 1);
                    return (
                      <li key={r.importer_iso3} className="grid grid-cols-[1fr_auto] items-center gap-x-2">
                        <span className="flex min-w-0 items-center gap-2"><Swatch color={tint(r.importer_iso3)} /><span className="truncate text-foreground">{name(r.importer_iso3)}</span></span>
                        <span className="text-foreground tabular-nums">{fmt(r.amount)}</span>
                        <span className="col-span-2 flex items-center gap-2">
                          <span className="h-1 flex-1 overflow-hidden rounded bg-[var(--tg-slate)]">
                            <span className="block h-full rounded" style={{ width: `${Math.max(1, s * 100)}%`, background: tint(r.importer_iso3) }} />
                          </span>
                          <span className="w-24 text-right text-xs text-muted-foreground">{pct(s, 0)} of its imports</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {choke.closable && (
                closed === choke.key ? (
                  <Button variant="outline" onClick={() => onCloseChoke(null)}>Reopen {choke.name}</Button>
                ) : (
                  <Button variant="outline" onClick={() => onCloseChoke(choke.key)}>Simulate closing {choke.name}</Button>
                )
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">The route network does not tag this strait, so no trade is assigned to it. Its traffic is shown as observed context.</p>
          )}
        </div>
      </div>
    </section>
  );
}
