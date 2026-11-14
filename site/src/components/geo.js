// Shared geography helpers: country polygons, borders and an anchor point per BACI ISO3 code.
import * as d3 from "npm:d3";
import * as topojson from "npm:topojson-client";

// geoRows: [{iso3, iso_num, country_name}] from country_geo.parquet
export function prepareGeo(world, geoRows) {
  const countries = topojson.feature(world, world.objects.countries);
  const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
  const byNum = new Map(geoRows.map((d) => [String(d.iso_num).padStart(3, "0"), d]));
  // Anchor = centroid of the country's largest polygon, so overseas territories don't drag it into the ocean.
  const anchor = new Map();
  for (const f of countries.features) {
    const g = byNum.get(f.id);
    if (!g) continue;
    const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map((c) => ({type: "Polygon", coordinates: c})) : [f.geometry];
    anchor.set(g.iso3, d3.geoCentroid(d3.greatest(polys, (p) => d3.geoArea(p))));
  }
  return {countries, borders, byNum, anchor};
}

const NAME_OVERRIDE = {S19: "Other Asia, nes (incl. Taiwan)"};
export const cname = (iso3, name) => NAME_OVERRIDE[iso3] ?? name ?? iso3;
