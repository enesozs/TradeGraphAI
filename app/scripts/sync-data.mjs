// Copy the pipeline marts the app reads (and the Natural Earth country geometry) into public/data.
// public/data is committed, so the app builds and deploys without the pipeline. Without a local pipeline build
// (a fresh clone, or a Vercel build) the committed copy is kept as it is.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const marts = join(here, "..", "..", "data", "marts", "HS12_V202601");
const out = join(here, "..", "public", "data");

// Tables registered in src/lib/db.ts (TABLES) and JSON files read with useJson/json.
const TABLES = [
  "importer_basket_year", "supplier_basket_year", "movers_importer", "movers_supplier",
  "network_nodes", "network_edges", "country_geo", "forecast_predictions",
  "scenario_summary", "scenario_importer", "scenario_mc_importer", "scenario_flows",
  "comext_importer", "comext_supplier",
  "sea_routes", "sea_route_closures", "sea_lane_load", "sea_mode_summary", "chokepoints", "chokepoint_exposure",
  "chokepoint_importer", "chokepoint_closure", "chokepoint_traffic",
  "substitution_events", "nowcast_totals", "nowcast_suppliers", "transport_mode",
];
const JSON_FILES = [
  "build_info", "comext_info", "forecast_metrics", "gravity_fit", "nowcast_metrics", "sea_info", "sea_lanes",
  "substitution_metrics",
];
const FILES = [...TABLES.map((t) => `${t}.parquet`), ...JSON_FILES.map((j) => `${j}.json`)];

if (!existsSync(marts)) {
  const have = existsSync(out) ? readdirSync(out).length : 0;
  if (have === 0) {
    console.error(`No pipeline marts at ${marts} and no data in public/data. Run the pipeline: uv run tradegraph all`);
    process.exit(1);
  }
  console.log(`No local pipeline marts; using the ${have} committed files in public/data.`);
  process.exit(0);
}

const missing = FILES.filter((f) => !existsSync(join(marts, f)));
if (missing.length) {
  console.error(`The pipeline marts lack files the app reads: ${missing.join(", ")}`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const keep = new Set([...FILES, "countries-110m.json"]);
for (const f of readdirSync(out)) if (!keep.has(f)) rmSync(join(out, f)); // files the app no longer reads
for (const f of FILES) copyFileSync(join(marts, f), join(out, f));
copyFileSync(join(here, "..", "node_modules", "world-atlas", "countries-110m.json"), join(out, "countries-110m.json"));
console.log(`synced ${FILES.length} mart files + countries-110m.json -> public/data`);
