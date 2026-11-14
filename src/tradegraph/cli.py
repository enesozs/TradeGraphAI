"""Command line: `tradegraph fetch | curate | marts | wdi | all`."""

from __future__ import annotations

import argparse
from pathlib import Path

from tradegraph import curate, marts
from tradegraph.config import load_baskets, load_pipeline
from tradegraph.ingestion import baci, wdi


def _years(arg: str | None) -> list[int] | None:
    if not arg:
        return None
    if "-" in arg:
        a, b = (int(x) for x in arg.split("-"))
        return list(range(a, b + 1))
    return [int(x) for x in arg.split(",")]


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="tradegraph")
    p.add_argument(
        "command",
        choices=[
            "fetch",
            "curate",
            "marts",
            "wdi",
            "gravity",
            "forecast",
            "scenarios",
            "comext",
            "sea",
            "substitution",
            "nowcast",
            "transport",
            "all",
        ],
    )
    p.add_argument("--years", help="e.g. 2023 or 2012-2024 or 2019,2023 (default: pipeline.yaml)")
    p.add_argument("--config", default="configs/pipeline.yaml")
    p.add_argument("--baskets", default="configs/baskets.yaml")
    p.add_argument("--out", help="marts output dir (default: data/marts/<release>; use for analysis runs)")
    a = p.parse_args(argv)

    cfg = load_pipeline(a.config)
    years = _years(a.years)
    if a.command in ("fetch", "all"):
        baci.fetch(cfg.baci, cfg.data_dir, years)
    if a.command in ("wdi", "all"):
        wdi.fetch(cfg.wdi, cfg.data_dir)
    if a.command in ("curate", "all"):
        curate.curate(cfg.baci, cfg.data_dir, years)
    if a.command in ("marts", "all"):
        marts.build_marts(cfg, load_baskets(a.baskets), Path(a.baskets), out_dir=Path(a.out) if a.out else None)
    if a.command in ("gravity", "all"):
        # Imported lazily: pyfixest is slow to import and only needed here.
        from tradegraph.ingestion import gravity as grav_ingest
        from tradegraph.models import build as grav_build
        from tradegraph.models import covariates

        grav_ingest.fetch(cfg.gravity, cfg.data_dir)
        covariates.curate(cfg)
        grav_build.build(cfg, load_baskets(a.baskets))
    if a.command in ("forecast", "all"):
        from tradegraph.forecast import benchmark

        benchmark.run(cfg, load_baskets(a.baskets))
    if a.command in ("comext", "all"):
        from tradegraph import comext_marts
        from tradegraph.ingestion import comext

        b = load_baskets(a.baskets)
        comext.fetch(cfg.comext, cfg.data_dir, sorted({c for _, c in b.rows()}))
        comext_marts.build(cfg, b)
    if a.command in ("transport", "all"):  # before `sea`: the sea model uses the observed EU sea shares
        from tradegraph import transport_marts
        from tradegraph.ingestion import transport

        transport.fetch(cfg.data_dir, transport.wanted())
        transport_marts.build(cfg, load_baskets(a.baskets))
    if a.command in ("nowcast", "all"):
        from tradegraph.ingestion import fx
        from tradegraph.models import nowcast_build

        fx.fetch(cfg.data_dir)
        nowcast_build.build(cfg, load_baskets(a.baskets))
    if a.command in ("substitution", "all"):
        from tradegraph.models import substitution_build

        substitution_build.build(cfg, load_baskets(a.baskets))
    if a.command in ("scenarios", "all"):
        from tradegraph.scenarios import studio

        studio.build(cfg, load_baskets(a.baskets))
    if a.command in ("sea", "all"):
        from tradegraph.routes import build as sea_build

        sea_build.build(cfg)


if __name__ == "__main__":
    main()
