"""Reproduce the figures behind reports/m2_rare_earths/finding.md.

Run from the repo root after `uv run tradegraph all`:
    uv run python reports/m2_rare_earths/build.py
Writes reports/m2_rare_earths/figures.json (every number cited in the finding).
"""

from __future__ import annotations

import json
from pathlib import Path

import duckdb

from tradegraph.config import load_baskets, load_pipeline
from tradegraph.marts import build_marts

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BASKETS = ROOT / "configs/analysis/rare_earths_split.yaml"
IMPORTERS = ("DEU", "USA")
FOCUS = "CHN"


def main() -> None:
    cfg = load_pipeline(ROOT / "configs/pipeline.yaml")
    cfg.paths["data_dir"] = str(ROOT / cfg.data_dir)
    out = ROOT / "data/analysis/m2_rare_earths"
    build_marts(cfg, load_baskets(BASKETS), BASKETS, out_dir=out, log=lambda *_: None)
    mv = cfg.movers
    s0, s1 = mv.start_years
    e0, e1 = mv.end_years
    imp, sup = out / "importer_basket_year.parquet", out / "supplier_basket_year.parquet"
    con = duckdb.connect()

    def q(sql: str) -> list[dict]:
        cur = con.execute(sql)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

    importers = ", ".join(f"'{x}'" for x in IMPORTERS)
    yearly = q(f"""
        SELECT i.basket_id, i.importer_iso3, i.year, i.is_provisional,
               i.imports_kusd, i.imports_t, i.supplier_count, i.hhi_value, i.hhi_tonnes, i.tonnes_coverage,
               coalesce(s.share_value, 0) AS focus_share_value, s.share_tonnes AS focus_share_tonnes,
               i.top1_supplier_iso3
        FROM '{imp}' i
        LEFT JOIN '{sup}' s ON s.basket_id = i.basket_id AND s.importer_iso3 = i.importer_iso3
                            AND s.year = i.year AND s.supplier_iso3 = '{FOCUS}'
        WHERE i.importer_iso3 IN ({importers})
        ORDER BY 1, 2, 3""")

    def window(rows, a, b):
        sel = [r for r in rows if a <= r["year"] <= b]

        def avg(k: str) -> float:
            vals = [r[k] for r in sel if r[k] is not None]
            return sum(vals) / len(vals) if vals else float("nan")

        keys = ("imports_kusd", "imports_t", "hhi_value", "hhi_tonnes", "focus_share_value", "focus_share_tonnes")
        return {k: avg(k) for k in keys} | {"years": [r["year"] for r in sel]}

    summary = {}
    for b in sorted({r["basket_id"] for r in yearly}):
        for m in IMPORTERS:
            rows = [r for r in yearly if r["basket_id"] == b and r["importer_iso3"] == m]
            summary[f"{b}/{m}"] = {"start": window(rows, s0, s1), "end": window(rows, e0, e1)}

    # Who lost share: top movers per importer in the full basket (from the analysis movers mart).
    losers = q(f"""
        SELECT importer_iso3, supplier_iso3, supplier_name, start_share, end_share, delta_share
        FROM '{out / "movers_supplier.parquet"}'
        WHERE basket_id = 're_all' AND importer_iso3 IN ({importers})
        QUALIFY row_number() OVER (PARTITION BY importer_iso3 ORDER BY abs(delta_share) DESC) <= 5
        ORDER BY importer_iso3, abs(delta_share) DESC""")

    info = json.loads((out / "build_info.json").read_text())
    result = {
        "source": info["source"],
        "windows": {"start": [s0, s1], "end": [e0, e1]},
        "focus_supplier": FOCUS,
        "summary": summary,
        "top_share_shifts_full_basket": losers,
        "yearly": yearly,
    }
    (HERE / "figures.json").write_text(json.dumps(result, indent=1, default=float))
    for k, v in summary.items():
        st, en = v["start"], v["end"]
        print(
            f"{k:22s} CHN value {st['focus_share_value']:.3f}->{en['focus_share_value']:.3f} | "
            f"CHN tonnes {st['focus_share_tonnes'] or 0:.3f}->{en['focus_share_tonnes'] or 0:.3f} | "
            f"HHI {st['hhi_value']:.3f}->{en['hhi_value']:.3f} | imports $m {st['imports_kusd'] / 1e3:.0f}->"
            f"{en['imports_kusd'] / 1e3:.0f} | kt {st['imports_t'] / 1e3:.1f}->{en['imports_t'] / 1e3:.1f}"
        )
    for r in losers:
        print(f"  {r['importer_iso3']} {r['supplier_iso3']:4s} {r['start_share']:.3f}->{r['end_share']:.3f}")


if __name__ == "__main__":
    main()
