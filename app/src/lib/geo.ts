// Country polygons (Natural Earth 1:110m via world-atlas) and one anchor point per BACI ISO3 code.
import { geoArea, geoCentroid } from "d3";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { useEffect, useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { json, query } from "./db";

export type CountryGeo = { iso3: string; iso_num: number; country_name: string };
export type Geo = {
  countries: FeatureCollection<Polygon | MultiPolygon, { iso3?: string; name?: string }>;
  anchor: Map<string, [number, number]>;
  names: Map<string, string>;
};

// Small states and territories with no polygon in the 1:110m map still need an anchor for their flows and dots.
const POINT_ANCHORS: Record<string, [number, number]> = {
  HKG: [114.17, 22.32], SGP: [103.82, 1.35], MAC: [113.54, 22.2], MLT: [14.45, 35.9], BHR: [50.56, 26.07],
  MDV: [73.51, 4.18], MUS: [57.55, -20.25], BRB: [-59.55, 13.17], AND: [1.52, 42.51], LIE: [9.55, 47.14],
  SMR: [12.46, 43.94], SYC: [55.45, -4.62], COM: [43.33, -11.7], STP: [6.61, 0.19], CPV: [-23.6, 15.1],
  ATG: [-61.8, 17.07], DMA: [-61.37, 15.41], GRD: [-61.68, 12.12], KNA: [-62.78, 17.3], LCA: [-60.98, 13.9],
  VCT: [-61.2, 13.25], TON: [-175.2, -21.18], WSM: [-171.76, -13.76], KIR: [173.0, 1.42], FSM: [158.2, 6.92],
  MHL: [171.38, 7.1], PLW: [134.48, 7.5], NRU: [166.93, -0.53], TUV: [179.2, -8.52], ABW: [-69.97, 12.52],
  CUW: [-68.93, 12.17], BMU: [-64.78, 32.3], CYM: [-81.25, 19.31], GIB: [-5.35, 36.14],
};

// Globe view: deck.gl subdivides every line and outline in longitude/latitude, so a step from 179° to -179°
// is filled in the long way round (a 358° ring around the pole). Making longitudes continuous along each line
// (values may then pass ±180°, which the globe draws in the same place) keeps every step short.
export function unwrapLongitudes<P extends number[]>(pts: P[]): P[] {
  let off = 0;
  return pts.map((p, k) => {
    if (k > 0) {
      const step = p[0] - pts[k - 1][0];
      if (step > 180) off -= 360;
      else if (step < -180) off += 360;
    }
    return (off === 0 ? p : [p[0] + off, ...p.slice(1)]) as P;
  });
}

export function unwrapCountries(fc: Geo["countries"]): Geo["countries"] {
  return {
    ...fc,
    features: fc.features.map((f) => ({
      ...f,
      geometry:
        f.geometry.type === "Polygon"
          ? { ...f.geometry, coordinates: f.geometry.coordinates.map((r) => unwrapLongitudes(r)) }
          : { ...f.geometry, coordinates: f.geometry.coordinates.map((poly) => poly.map((r) => unwrapLongitudes(r))) },
    })),
  };
}

let geoPromise: Promise<Geo> | null = null;

export function loadGeo(): Promise<Geo> {
  geoPromise ??= (async () => {
    const [topo, rows] = await Promise.all([
      json<Topology<{ countries: GeometryCollection }>>("countries-110m.json"),
      query<CountryGeo>("SELECT iso3, iso_num, country_name FROM country_geo"),
    ]);
    const byNum = new Map(rows.filter((r) => r.iso_num != null).map((r) => [String(r.iso_num).padStart(3, "0"), r]));
    const fc = feature(topo, topo.objects.countries) as unknown as Geo["countries"];
    const anchor = new Map<string, [number, number]>();
    for (const f of fc.features as Feature<Polygon | MultiPolygon, { iso3?: string; name?: string }>[]) {
      const g = byNum.get(String(f.id));
      if (!g) continue;
      f.properties = { ...f.properties, iso3: g.iso3 };
      // Anchor at the centroid of the largest polygon, so overseas territories don't drag it into the ocean.
      const polys: Polygon[] =
        f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map((c) => ({ type: "Polygon", coordinates: c })) : [f.geometry];
      const largest = polys.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
      anchor.set(g.iso3, geoCentroid(largest) as [number, number]);
    }
    for (const r of rows) if (!anchor.has(r.iso3) && POINT_ANCHORS[r.iso3]) anchor.set(r.iso3, POINT_ANCHORS[r.iso3]);
    const names = new Map(rows.map((r) => [r.iso3, r.iso3 === "S19" ? "Taiwan (Other Asia, nes)" : r.country_name]));
    return { countries: fc, anchor, names };
  })();
  return geoPromise;
}

export function useGeo(): Geo | null {
  const [g, setG] = useState<Geo | null>(null);
  useEffect(() => {
    loadGeo().then(setG);
  }, []);
  return g;
}
