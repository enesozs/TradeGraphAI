"""ML F (EU scope): extra-EU trade by mode of transport, by HS6 product (Eurostat Comext bulk, TRANSPORT_HS).

Files: trhs_v2_YYYY52.7z (annual) and trhs_v2_YYYYMM.7z (monthly), each one CSV with columns
REPORTER, PARTNER, PRODUCT, FLOW, TRANSPORT_MODE, PERIOD, VALUE_EUR, VALUE_NAC, QUANTITY_KG.
Mode is the active means of transport at the EU's external border (sea, air, road, rail, ...).

Licence: Eurostat reuse policy - reuse with acknowledgement; modified data must be flagged as such with a
disclaimer of Eurostat's non-responsibility. Owner approval for the download (727.0 MB, annual 2012-2025 plus
January-August 2026): 2026-11-11, ADR-014.
Attribution: "Source: Eurostat (Comext, extra-EU trade by mode of transport, HS6), © European Union; adapted by
TradeGraph AI".

Raw archives are kept unchanged with SHA-256 checksums; extraction filters them to the basket products.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

BASE = "https://ec.europa.eu/eurostat/api/dissemination/files/?file="
FOLDER = "comext/COMEXT_DATA/TRANSPORT_HS/"
USER_AGENT = "TradeGraphAI/0.1 (open research project)"
LICENCE = "Eurostat reuse policy (acknowledgement required; adapted)"


def raw_dir(data_dir: Path) -> Path:
    return data_dir / "raw" / "eurostat_transport"


def wanted(
    first_year: int = 2012, last_full_year: int = 2025, partial_year: int = 2026, partial_months: int = 8
) -> list[str]:
    names = [f"trhs_v2_{y}52.7z" for y in range(first_year, last_full_year + 1)]
    names += [f"trhs_v2_{partial_year}{m:02d}.7z" for m in range(1, partial_months + 1)]
    return names


def fetch(data_dir: Path, names: list[str], log=print, pause: float = 1.0) -> dict:
    """Download each archive once (resumable across runs: files already in the manifest are skipped)."""
    out = raw_dir(data_dir)
    out.mkdir(parents=True, exist_ok=True)
    mpath = out / "manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else {}
    for name in names:
        dest = out / name
        if name in manifest and dest.exists() and dest.stat().st_size == manifest[name]["bytes"]:
            log(f"skip  {name}")
            continue
        url = BASE + urllib.parse.quote(FOLDER + name, safe="")
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        tmp = dest.with_suffix(".part")
        h = hashlib.sha256()
        with urllib.request.urlopen(req, timeout=600) as r, tmp.open("wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
                h.update(chunk)
        tmp.rename(dest)
        manifest[name] = {
            "bytes": dest.stat().st_size,
            "sha256": h.hexdigest(),
            "source_url": url,
            "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "license": LICENCE,
        }
        mpath.write_text(json.dumps(manifest, indent=1, sort_keys=True))
        log(f"fetch {name}: {dest.stat().st_size / 1e6:.1f} MB")
        time.sleep(pause)
    return manifest
