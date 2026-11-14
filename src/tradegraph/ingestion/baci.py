"""Fetch BACI files into an immutable raw snapshot with a checksum manifest."""

from __future__ import annotations

from pathlib import Path

from tradegraph.config import BaciSettings
from tradegraph.ingestion.remote_zip import fetch_members

METADATA_FILES = ("Readme.txt", "country_codes_V{release}.csv", "product_codes_{hs}_V{release}.csv")


def raw_dir(data_dir: Path, s: BaciSettings) -> Path:
    return data_dir / "raw" / "baci" / f"{s.hs_revision}_V{s.release}"


def year_file(s: BaciSettings, year: int) -> str:
    return f"BACI_{s.hs_revision}_Y{year}_V{s.release}.csv"


def metadata_files(s: BaciSettings) -> list[str]:
    return [f.format(release=s.release, hs=s.hs_revision) for f in METADATA_FILES]


def fetch(s: BaciSettings, data_dir: Path, years: list[int] | None = None, log=print) -> dict[str, dict]:
    """Download metadata files and the requested years (skipping files already verified)."""
    wanted = metadata_files(s) + [year_file(s, y) for y in (years or s.year_list)]
    return fetch_members(
        s.url,
        wanted,
        raw_dir(data_dir, s),
        extra={"release": s.release, "hs_revision": s.hs_revision, "license": "Etalab Open Licence 2.0 (CEPII BACI)"},
        log=log,
    )
