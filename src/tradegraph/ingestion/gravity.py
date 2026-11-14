"""Fetch the CEPII Gravity database (pair covariates) into data/raw/gravity/V<release>/."""

from __future__ import annotations

from pathlib import Path

from tradegraph.config import GravitySettings
from tradegraph.ingestion.remote_zip import fetch_members


def raw_dir(data_dir: Path, s: GravitySettings) -> Path:
    return data_dir / "raw" / "gravity" / f"V{s.release}"


def main_file(s: GravitySettings) -> str:
    return f"Gravity_V{s.release}.csv"


def fetch(s: GravitySettings, data_dir: Path, log=print) -> dict[str, dict]:
    wanted = [main_file(s), f"Countries_V{s.release}.csv"]
    extra = {"release": s.release, "license": "Etalab Open Licence 2.0 (CEPII Gravity)"}
    return fetch_members(s.url, wanted, raw_dir(data_dir, s), extra=extra, log=log)
