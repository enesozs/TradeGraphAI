"""`tradegraph sea`: modelled sea routes, chokepoint exposure and chokepoint-closure scenarios.

Inputs: BACI marts (supplier_basket_year), CEPII Gravity pairs (contiguity, distance), searoute's MARNET
network, and IMF PortWatch (ports, chokepoints, daily chokepoint transits).

Outputs (marts dir); everything route-based is a MODEL, closures are SCENARIOS:
  sea_routes.parquet          pair -> mode class, modelled sea km, chokepoints passed, gateway ports
  sea_route_closures.parquet  pair x closed chokepoint -> alternative km, extra km, reachable
  sea_lanes.json              lane segments (merged unbranched network chains) used by any route, for drawing
  sea_lane_load.parquet       tonnes/value per lane edge: base for every year, closures for `closure_year`
  sea_mode_summary.parquet    basket x year x mode class: tonnes, value, pairs (coverage of the model)
  chokepoint_exposure.parquet basket x year x chokepoint: tonnes and value routed through it
  chokepoint_importer.parquet basket x year x importer x chokepoint, with all-partner import denominators
  chokepoint_closure.parquet  closure_year: basket x closed x importer: affected, rerouted, no alternative
  chokepoints.parquet         chokepoint reference (modelled passages + PortWatch-only chokepoints)
  chokepoint_traffic.parquet  PortWatch daily transits aggregated to weekly averages (IMF data, attributed)
  sea_info.json               sources, licences, attribution and model parameters
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from tradegraph.config import PipelineConfig
from tradegraph.marts import marts_dir
from tradegraph.routes.sea import Network, Router, classify, segments, snap

# Display names and PortWatch counterparts of the modelled passages.
CHOKEPOINTS = {
    "suez": ("Suez Canal", "Suez Canal"),
    "bab_el_mandeb": ("Bab el-Mandeb", "Bab el-Mandeb Strait"),
    "hormuz": ("Strait of Hormuz", "Strait of Hormuz"),
    "malacca": ("Strait of Malacca", "Malacca Strait"),
    "sunda": ("Sunda Strait", "Sunda Strait"),
    "panama": ("Panama Canal", "Panama Canal"),
    "gibraltar": ("Strait of Gibraltar", "Gibraltar Strait"),
    "turkish_straits": ("Turkish Straits", "Bosporus Strait"),
    "cape_of_good_hope": ("Cape of Good Hope", "Cape of Good Hope"),
    "cape_horn_magellan": ("Cape Horn and Magellan", "Magellan Strait"),
    "bering": ("Bering Strait", "Bering Strait"),
}
# BACI uses S19 for Taiwan; PortWatch and CEPII Gravity use TWN.
BACI_TO_ISO = {"S19": "TWN"}


def _ports(raw: Path, per_country: int) -> pd.DataFrame:
    p = pd.read_csv(raw / "ports.csv")
    p = p[p["ISO3"].notna() & p["lat"].notna() & p["lon"].notna()].copy()
    p["score"] = p["share_country_maritime_import"].fillna(0) + p["share_country_maritime_export"].fillna(0)
    p = p.sort_values(["ISO3", "score", "vessel_count_total"], ascending=[True, False, False])
    return p.groupby("ISO3").head(per_country).reset_index(drop=True)


def _first_date(raw: Path) -> str:
    return str(
        duckdb.sql(
            f"SELECT min(CAST(date AS DATE)) FROM read_csv('{raw / 'daily_chokepoints.csv'}', header = true)"
        ).fetchall()[0][0]
    )


def _traffic(raw: Path) -> pd.DataFrame:
    return duckdb.sql(f"""
        SELECT portid AS portwatch_id, portname AS name, date_trunc('week', CAST(date AS DATE)) AS week,
               count(*) AS days, avg(n_total) AS n_total, avg(n_container) AS n_container,
               avg(n_dry_bulk) AS n_dry_bulk, avg(n_tanker) AS n_tanker, avg(n_general_cargo) AS n_general_cargo,
               avg(n_roro) AS n_roro, avg(capacity) AS capacity_t
        FROM read_csv('{raw / "daily_chokepoints.csv"}', header = true)
        GROUP BY ALL ORDER BY 1, 3
    """).df()


MAX_NO_PORT_VALUE_SHARE = 0.05


def _check_port_coverage(sup: pd.DataFrame, with_ports: set[str], log) -> None:
    """Guard: countries without a gateway port should be (mostly landlocked and) a small share of trade value."""
    v = pd.concat([sup[["exporter", "value_kusd"]].rename(columns={"exporter": "c"}),
                   sup[["importer", "value_kusd"]].rename(columns={"importer": "c"})]).groupby("c")["value_kusd"].sum()  # fmt: skip
    miss = v[[BACI_TO_ISO.get(c, c) not in with_ports for c in v.index]].sort_values(ascending=False)
    share = float(miss.sum() / v.sum())
    log(f"sea: no gateway port for {len(miss)} countries ({share:.1%} of value), largest: {', '.join(miss.index[:6])}")
    if share > MAX_NO_PORT_VALUE_SHARE:
        raise ValueError(f"countries without ports carry {share:.1%} of trade value; check the PortWatch ISO3 mapping")


def build(cfg: PipelineConfig, log=print) -> Path:
    from searoute.searoute import setup_M  # imported lazily: builds the network (~1 s)

    s = cfg.sea
    out = marts_dir(cfg.data_dir, cfg.baci.release, cfg.baci.hs_revision)
    raw = cfg.data_dir / "raw" / "portwatch"
    net = Network.from_graph(setup_M())

    # Gateway ports: each country's top ports by share of its maritime trade, snapped to the network.
    ports = _ports(raw, s.ports_per_country)
    node, snap_km = snap(net, ports[["lon", "lat"]].to_numpy())
    ports["node"], ports["snap_km"] = node, snap_km
    ports = ports[ports["snap_km"] <= s.max_snap_km].reset_index(drop=True)
    ports["rank"] = ports.groupby("ISO3").cumcount()
    by_country = ports.groupby("ISO3").groups
    log(f"sea: {len(ports)} gateway ports in {len(by_country)} countries")

    sup = duckdb.sql(f"""
        SELECT basket_id, year, supplier_iso3 AS exporter, importer_iso3 AS importer, value_kusd, quantity_t AS tonnes
        FROM '{out / "supplier_basket_year.parquet"}' WHERE supplier_iso3 <> importer_iso3
    """).df()
    pairs = sup[["exporter", "importer"]].drop_duplicates().reset_index(drop=True)
    _check_port_coverage(sup, set(by_country), log)
    grav = duckdb.sql(
        f"SELECT iso3_o, iso3_d, dist_km, contig FROM '{cfg.data_dir / 'curated/gravity' / ('V' + cfg.gravity.release) / 'pairs.parquet'}'"
    ).df()
    gl = {(o, d): (km, c) for o, d, km, c in grav.itertuples(index=False)}

    router = lambda closed=(): Router(net, ports["node"].to_numpy(), ports["snap_km"].to_numpy(), closed,  # noqa: E731
                                      ports["rank"].to_numpy(), s.secondary_port_penalty)  # fmt: skip
    base = router()
    iso = lambda c: BACI_TO_ISO.get(c, c)  # noqa: E731
    routes, route_obj = [], {}
    for k, (e, i) in enumerate(pairs.itertuples(index=False)):
        oe, oi = by_country.get(iso(e)), by_country.get(iso(i))
        r = base.best(list(oe), list(oi)) if oe is not None and oi is not None else None
        km_c = gl.get((iso(e), iso(i))) or gl.get((iso(i), iso(e)))
        dist_km, contig = (float(km_c[0]), bool(km_c[1])) if km_c else (None, False)
        cls = classify(contig, oe is not None, oi is not None, r.km if r else float("inf"), dist_km,
                       s.detour_ratio, s.detour_max_km)  # fmt: skip
        routes.append({
            "pair_id": k, "exporter_iso3": e, "importer_iso3": i, "mode_class": cls,
            "sea_km": r.km if r and np.isfinite(r.km) else None, "dist_km": dist_km,
            "chokepoints": "|".join(r.chokepoints) if r else "",
            "origin_port": ports.at[r.origin_port, "portname"] if r and r.origin_port >= 0 else None,
            "dest_port": ports.at[r.dest_port, "portname"] if r and r.dest_port >= 0 else None,
        })  # fmt: skip
        if cls == "sea":
            route_obj[k] = r
    routes = pd.DataFrame(routes)
    log(f"sea: {len(routes)} pairs; " + ", ".join(f"{c} {n}" for c, n in routes["mode_class"].value_counts().items()))

    # Closures: only pairs whose base route passes the closed chokepoint change.
    closures, closure_edges = [], {}
    for ck in s.closures:
        hit = [k for k, r in route_obj.items() if ck in r.chokepoints]
        if not hit:
            continue
        alt = router([ck])
        for k in hit:
            e, i = routes.at[k, "exporter_iso3"], routes.at[k, "importer_iso3"]
            a = alt.best(list(by_country[iso(e)]), list(by_country[iso(i)]))
            ok = bool(np.isfinite(a.km))
            closures.append({
                "pair_id": k, "exporter_iso3": e, "importer_iso3": i, "closed": ck, "reachable": ok,
                "base_km": route_obj[k].km, "alt_km": a.km if ok else None,
                "extra_km": a.km - route_obj[k].km if ok else None, "alt_chokepoints": "|".join(a.chokepoints),
            })  # fmt: skip
            if ok:
                closure_edges[(ck, k)] = a.edge_ids
        log(f"sea: closure {ck}: {len(hit)} pairs rerouted or cut")
    closures = pd.DataFrame(closures)

    # Lanes: merge used edges into unbranched segments; loads are summed per segment (exact, see segments()).
    used = {eid for r in route_obj.values() for eid in r.edge_ids} | {
        eid for ids in closure_edges.values() for eid in ids
    }
    seg_of, seg_paths = segments(net, used, breakpoints=ports["node"].to_numpy())
    to_segs = lambda ids: sorted({seg_of[e] for e in ids})  # noqa: E731
    base_pe = pd.DataFrame([(k, sid) for k, r in route_obj.items() for sid in to_segs(r.edge_ids)],
                           columns=["pair_id", "edge_id"])  # fmt: skip
    alt_pe = pd.DataFrame([(ck, k, sid) for (ck, k), ids in closure_edges.items() for sid in to_segs(ids)],
                          columns=["closed", "pair_id", "edge_id"])  # fmt: skip
    seg_cp: dict[int, set[str]] = {}
    for e in used:
        if net.chokepoint[e]:
            seg_cp.setdefault(seg_of[e], set()).add(net.chokepoint[e])
    lanes_json = [
        {"id": sid, "path": [[round(float(x), 3), round(float(y), 3)] for x, y in net.coords[path]],
         "chokepoints": sorted(seg_cp.get(sid, ()))}
        for sid, path in enumerate(seg_paths)
    ]  # fmt: skip
    (out / "sea_lanes.json").write_text(json.dumps(lanes_json, separators=(",", ":")))
    (out / "sea_lanes.parquet").unlink(missing_ok=True)
    log(f"sea: {len(used)} lane edges merged into {len(seg_paths)} segments")

    con = duckdb.connect()
    for name, df in [
        ("sup", sup),
        ("routes", routes),
        ("closures", closures),
        ("base_pe", base_pe),
        ("alt_pe", alt_pe),
    ]:
        con.register(name, df)
    cy = int(s.closure_year)
    # ML F (EU scope): for EU importers, Eurostat records how each extra-EU import crossed the EU border. Where that
    # observation exists, a modelled sea flow is split into its observed sea part (which loads lanes and chokepoints)
    # and an 'eu_not_sea' remainder (air, road, rail, pipelines: no route, no chokepoints). Others are unchanged.
    tm = out / "transport_mode.parquet"
    eu_sea = (
        f"""SELECT reporter AS importer, partner_iso3 AS exporter, basket_id, year,
                   coalesce(sum(value_eur) FILTER (WHERE mode = 'sea'), 0) / nullif(sum(value_eur), 0) AS sea_v,
                   coalesce(sum(kg) FILTER (WHERE mode = 'sea'), 0) / nullif(sum(kg), 0) AS sea_t  -- none by sea = 0
            FROM '{tm}' WHERE reporter <> 'EU27_2020_EXTRA' AND months = 12 GROUP BY ALL"""
        if tm.exists()
        else "SELECT NULL::VARCHAR AS importer, NULL::VARCHAR AS exporter, NULL::VARCHAR AS basket_id, NULL::INT AS year, NULL::DOUBLE AS sea_v, NULL::DOUBLE AS sea_t WHERE false"
    )
    con.execute(f"""
        CREATE TABLE flows0 AS
        SELECT s.basket_id, s.year, r.pair_id, s.exporter, s.importer, r.mode_class, r.chokepoints,
               s.value_kusd, s.tonnes
        FROM sup s JOIN routes r ON r.exporter_iso3 = s.exporter AND r.importer_iso3 = s.importer;
        CREATE TABLE eu_sea AS {eu_sea};
        CREATE TABLE flows AS
        SELECT f.basket_id, f.year, f.pair_id, f.exporter, f.importer, f.mode_class, f.chokepoints,
               f.value_kusd * coalesce(e.sea_v, 1) AS value_kusd, f.tonnes * coalesce(e.sea_t, e.sea_v, 1) AS tonnes
        FROM flows0 f LEFT JOIN eu_sea e ON f.mode_class = 'sea' AND e.importer = f.importer AND e.exporter = f.exporter
             AND e.basket_id = f.basket_id AND e.year = f.year
        UNION ALL
        SELECT f.basket_id, f.year, NULL AS pair_id, f.exporter, f.importer, 'eu_not_sea' AS mode_class, '' AS chokepoints,
               f.value_kusd * (1 - e.sea_v), f.tonnes * (1 - coalesce(e.sea_t, e.sea_v))
        FROM flows0 f JOIN eu_sea e ON f.mode_class = 'sea' AND e.importer = f.importer AND e.exporter = f.exporter
             AND e.basket_id = f.basket_id AND e.year = f.year
        WHERE e.sea_v < 1;
    """)  # noqa: S608
    con.execute("""
        CREATE TABLE imports AS
        SELECT basket_id, year, importer, sum(value_kusd) AS imports_kusd, sum(tonnes) AS imports_t
        FROM flows GROUP BY ALL;
        CREATE TABLE fx AS  -- one row per flow x chokepoint passed (base route)
        SELECT f.*, unnest(string_split(f.chokepoints, '|')) AS chokepoint FROM flows f
        WHERE f.mode_class = 'sea' AND f.chokepoints <> '';
    """)
    q = lambda sql, path: con.execute(f"COPY ({sql}) TO '{out / path}' (FORMAT parquet, COMPRESSION zstd)")  # noqa: E731
    q(
        "SELECT pair_id, exporter_iso3, importer_iso3, mode_class, sea_km, dist_km, chokepoints, origin_port, dest_port FROM routes",
        "sea_routes.parquet",
    )
    q("SELECT * FROM closures", "sea_route_closures.parquet")
    q(f"""
        SELECT basket_id, year, scenario, edge_id, tonnes::FLOAT AS tonnes, value_kusd::FLOAT AS value_kusd FROM (
        SELECT f.basket_id, f.year, 'base' AS scenario, pe.edge_id, sum(f.tonnes) AS tonnes, sum(f.value_kusd) AS value_kusd
        FROM flows f JOIN base_pe pe USING (pair_id) GROUP BY ALL
        UNION ALL
        -- closure: unaffected pairs keep their base path, rerouted pairs use the alternative path
        SELECT f.basket_id, f.year, c.ck AS scenario, x.edge_id, sum(f.tonnes), sum(f.value_kusd)
        FROM flows f CROSS JOIN (SELECT DISTINCT closed AS ck FROM closures) c
        JOIN (
            SELECT NULL::VARCHAR AS closed, pair_id, edge_id FROM base_pe
            UNION ALL SELECT closed, pair_id, edge_id FROM alt_pe
        ) x ON x.pair_id = f.pair_id AND (
            (x.closed IS NULL AND f.pair_id NOT IN (SELECT pair_id FROM closures WHERE closed = c.ck))
            OR x.closed = c.ck)
        WHERE f.year = {cy}
        GROUP BY ALL
        ) ORDER BY basket_id, year, scenario, edge_id
    """, "sea_lane_load.parquet")  # fmt: skip
    q("""
        SELECT basket_id, year, mode_class, sum(tonnes) AS tonnes, sum(value_kusd) AS value_kusd, count(*) AS pairs,
               count(*) FILTER (WHERE tonnes IS NULL) AS pairs_without_tonnes
        FROM flows GROUP BY ALL ORDER BY ALL
    """, "sea_mode_summary.parquet")  # fmt: skip
    q("""
        SELECT x.basket_id, x.year, x.chokepoint, sum(x.tonnes) AS tonnes, sum(x.value_kusd) AS value_kusd,
               count(*) AS pairs, any_value(w.world_t) AS world_t, any_value(w.world_kusd) AS world_kusd
        FROM fx x JOIN (SELECT basket_id, year, sum(tonnes) AS world_t, sum(value_kusd) AS world_kusd FROM flows GROUP BY ALL) w
          USING (basket_id, year)
        GROUP BY ALL ORDER BY ALL
    """, "chokepoint_exposure.parquet")  # fmt: skip
    q("""
        SELECT x.basket_id, x.year, x.importer AS importer_iso3, x.chokepoint, sum(x.tonnes) AS tonnes,
               sum(x.value_kusd) AS value_kusd, any_value(m.imports_t) AS imports_t, any_value(m.imports_kusd) AS imports_kusd
        FROM fx x JOIN imports m USING (basket_id, year, importer)
        GROUP BY ALL ORDER BY ALL
    """, "chokepoint_importer.parquet")  # fmt: skip
    q(f"""
        SELECT f.basket_id, c.closed, f.importer AS importer_iso3,
               sum(f.tonnes) AS tonnes_affected, sum(f.value_kusd) AS value_affected_kusd,
               sum(f.tonnes) FILTER (WHERE NOT c.reachable) AS tonnes_no_route,
               sum(f.value_kusd) FILTER (WHERE NOT c.reachable) AS value_no_route_kusd,
               sum(f.tonnes * c.extra_km) FILTER (WHERE c.reachable) / nullif(sum(f.tonnes) FILTER (WHERE c.reachable), 0)
                   AS extra_km_tonne_weighted,
               any_value(m.imports_t) AS imports_t, any_value(m.imports_kusd) AS imports_kusd
        FROM flows f JOIN closures c USING (pair_id) JOIN imports m USING (basket_id, year, importer)
        WHERE f.year = {cy}
        GROUP BY ALL ORDER BY ALL
    """, "chokepoint_closure.parquet")  # fmt: skip

    # Invariant: in a closure scenario no load may cross a segment of the closed chokepoint.
    con.register(
        "seg_cp", pd.DataFrame([(sid, c) for sid, cs in seg_cp.items() for c in cs], columns=["edge_id", "cp"])
    )
    leak = con.execute(f"""
        SELECT count(*) FROM '{out / "sea_lane_load.parquet"}' l JOIN seg_cp USING (edge_id)
        WHERE l.scenario = seg_cp.cp AND l.tonnes > 0
    """).fetchall()[0][0]
    if leak:
        raise AssertionError(f"{leak} lane loads cross a closed chokepoint")

    cps = pd.read_csv(raw / "chokepoints.csv")
    pw_name_to_key = {pw: k for k, (_, pw) in CHOKEPOINTS.items()}
    ref = pd.DataFrame({
        "key": [pw_name_to_key.get(n, pid) for pid, n in zip(cps["portid"], cps["portname"], strict=True)],
        "name": [CHOKEPOINTS[pw_name_to_key[n]][0] if n in pw_name_to_key else n for n in cps["portname"]],
        "portwatch_id": cps["portid"], "portwatch_name": cps["portname"], "lat": cps["lat"], "lon": cps["lon"],
        "modelled": [n in pw_name_to_key for n in cps["portname"]],
        "closable": [pw_name_to_key.get(n) in s.closures for n in cps["portname"]],
        "vessel_count_total": cps["vessel_count_total"],
    })  # fmt: skip
    con.register("ref", ref)
    q("SELECT * FROM ref", "chokepoints.parquet")
    traffic = _traffic(raw)
    traffic["key"] = traffic["portwatch_id"].map(dict(zip(ref["portwatch_id"], ref["key"], strict=True)))
    con.register("traffic", traffic)
    q("SELECT key, portwatch_id, name, week, days, n_total, n_container, n_dry_bulk, n_tanker, n_general_cargo, n_roro, capacity_t FROM traffic", "chokepoint_traffic.parquet")  # fmt: skip

    pw_manifest = json.loads((raw / "manifest.json").read_text())
    info = {
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "closure_year": cy,
        "model": {
            "network": "searoute 1.6 (Apache-2.0) over Eurostat MARNET; Northwest Passage closed",
            "ports_per_country": s.ports_per_country,
            "secondary_port_penalty": s.secondary_port_penalty,
            "max_snap_km": s.max_snap_km,
            "detour_ratio": s.detour_ratio,
            "detour_max_km": s.detour_max_km,
            "gateway_ports": "top ports by PortWatch share of the country's maritime imports + exports",
            "route": "shortest network path over all gateway-port combinations of the two countries",
        },  # fmt: skip
        "portwatch": {
            "attribution": "Source: International Monetary Fund, PortWatch (portwatch.imf.org): Daily Chokepoint Transit Calls; Ports and Chokepoints databases.",
            "transformation": "Daily transit counts are aggregated to weekly averages; port shares are used only to choose gateway ports.",
            "licence": pw_manifest.get("license_info"),
            "retrieved_at": pw_manifest.get("retrieved_at"),
            "source": pw_manifest.get("source"),
            "first_date": _first_date(raw),
            "last_date": str(traffic["week"].max().date()),
        },  # fmt: skip
        "chokepoint_names": {k: v[0] for k, v in CHOKEPOINTS.items()},
    }
    (out / "sea_info.json").write_text(json.dumps(info, indent=1))
    log(f"sea: wrote marts to {out}")
    return out
