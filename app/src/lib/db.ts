// DuckDB-WASM over the pipeline's Parquet marts, self-hosted (no CDN at runtime).
import * as duckdb from "@duckdb/duckdb-wasm";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import mvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import { useEffect, useState } from "react";

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

// Every mart the app can query, registered as a view with the same name as the file stem.
export const TABLES = [
  "importer_basket_year", "supplier_basket_year", "movers_importer", "movers_supplier",
  "network_nodes", "network_edges", "country_geo", "forecast_predictions",
  "scenario_summary", "scenario_importer", "scenario_mc_importer", "scenario_flows",
  "comext_importer", "comext_supplier",
  "sea_routes", "sea_route_closures", "sea_lane_load", "sea_mode_summary", "chokepoints", "chokepoint_exposure",
  "chokepoint_importer", "chokepoint_closure", "chokepoint_traffic",
  "substitution_events", "nowcast_totals", "nowcast_suppliers", "transport_mode",
] as const;

const dataUrl = (file: string) => new URL(`data/${file}`, document.baseURI).href;

let dbPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

export function connection(): Promise<duckdb.AsyncDuckDBConnection> {
  dbPromise ??= (async () => {
    const bundle = await duckdb.selectBundle(BUNDLES);
    const worker = new Worker(bundle.mainWorker!);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule);
    const conn = await db.connect();
    for (const t of TABLES) {
      await db.registerFileURL(`${t}.parquet`, dataUrl(`${t}.parquet`), duckdb.DuckDBDataProtocol.HTTP, false);
      await conn.query(`CREATE VIEW ${t} AS SELECT * FROM read_parquet('${t}.parquet')`);
    }
    return conn;
  })();
  return dbPromise;
}

// Convert Arrow rows to plain objects; BigInt -> number and Date-ish values kept as numbers/strings.
function toPlain(row: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) o[k] = typeof v === "bigint" ? Number(v) : v;
  return o;
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await connection();
  const res = params.length ? await (await conn.prepare(sql)).query(...params) : await conn.query(sql);
  return res.toArray().map((r) => toPlain(r.toJSON() as Record<string, unknown>) as T);
}

export function useQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const [state, setState] = useState<{ data: T[] | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const key = JSON.stringify([sql, params]);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    query<T>(sql, params)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error: Error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export async function json<T>(file: string): Promise<T> {
  const r = await fetch(dataUrl(file));
  if (!r.ok) throw new Error(`Failed to load ${file}: ${r.status}`);
  return r.json() as Promise<T>;
}

export function useJson<T>(file: string) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    json<T>(file).then(setData);
  }, [file]);
  return data;
}
