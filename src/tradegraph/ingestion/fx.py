"""ML B: monthly euro to US dollar reference rates (Eurostat ert_bil_eur_m), to put Comext (EUR) on BACI's USD basis.

Source: Eurostat, dataset ert_bil_eur_m (monthly averages, USD per EUR), based on European Central Bank reference
rates. Licence: Eurostat reuse policy - reuse with acknowledgement; data owned by other sources (here the ECB)
may be reused non-commercially (owner approval for this project: 2026-11-11, ADR-012).
Attribution: "Source: Eurostat (ert_bil_eur_m), based on ECB euro reference rates".
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

URL = "https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/ert_bil_eur_m/M.AVG.NAC.USD?format=SDMX-CSV&startPeriod={start}"
USER_AGENT = "TradeGraphAI/0.1 (open research project)"
LICENCE = "Eurostat reuse policy; ECB-owned rates: non-commercial reuse with acknowledgement"
ATTRIBUTION = "Source: Eurostat (ert_bil_eur_m), based on ECB euro reference rates"


def raw_path(data_dir: Path) -> Path:
    return data_dir / "raw" / "fx" / "ert_bil_eur_m_usd.csv"


def fetch(data_dir: Path, start: str = "2012-01", log=print) -> Path:
    """Download the monthly USD-per-EUR series (always refreshed: it is a few kB)."""
    out = raw_path(data_dir)
    out.parent.mkdir(parents=True, exist_ok=True)
    url = URL.format(start=start)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
    out.write_bytes(body)
    manifest = {
        out.name: {
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "source_url": url,
            "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "license": LICENCE,
            "attribution": ATTRIBUTION,
        }
    }
    (out.parent / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    log(f"fetch fx {out.name}: {len(body) / 1e3:.1f} kB")
    return out


def load(path: Path) -> pd.DataFrame:
    """(year, month, usd_per_eur) from the SDMX-CSV file."""
    rows = []
    for r in csv.DictReader(io.StringIO(path.read_text())):
        y, m = r["TIME_PERIOD"].split("-")
        if r["OBS_VALUE"]:
            rows.append({"year": int(y), "month": int(m), "usd_per_eur": float(r["OBS_VALUE"])})
    return pd.DataFrame(rows)
