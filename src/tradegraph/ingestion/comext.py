"""L3: monthly EU import data from Eurostat Comext (dataset DS-045409, HS6 products).

Licence: Eurostat data may be reused (including commercially) with acknowledgement of the source;
adapted data must be flagged as adapted. Attribution used on the site:
"Source: Eurostat (Comext DS-045409), © European Union; adapted by TradeGraph AI".

One SDMX-CSV query per (reporter, year): all partners, all basket products, value (EUR) and quantity (100 kg).
Raw responses are stored unchanged with SHA-256 checksums in a manifest.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.parse
import urllib.request
from datetime import UTC, date, datetime
from pathlib import Path

from tradegraph.config import ComextSettings

INDICATORS = ("VALUE_IN_EUROS", "QUANTITY_IN_100KG")
USER_AGENT = "TradeGraphAI/0.1 (open research project)"


def raw_dir(data_dir: Path, s: ComextSettings) -> Path:
    return data_dir / "raw" / "comext" / s.dataset


def query_url(s: ComextSettings, reporter: str, products: list[str], year: int) -> str:
    key = f"M.{reporter}..{'+'.join(products)}.1.{'+'.join(INDICATORS)}"
    params = urllib.parse.urlencode({"startPeriod": f"{year}-01", "endPeriod": f"{year}-12", "format": "SDMX-CSV"})
    return f"{s.api}/{s.dataset}/{key}?{params}"


def fetch(s: ComextSettings, data_dir: Path, products: list[str], log=print, today: date | None = None) -> dict:
    out = raw_dir(data_dir, s)
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    this_year = (today or date.today()).year
    for reporter in s.reporters:
        for year in range(s.start_year, this_year + 1):
            name = f"{reporter}_{year}.csv"
            # Past complete years are immutable once fetched; the current year is always refreshed.
            if name in manifest and year < this_year and (out / name).exists():
                log(f"skip  comext {name}")
                continue
            url = query_url(s, reporter, products, year)
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            (out / name).write_bytes(body)
            manifest[name] = {
                "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
                "source_url": url,
                "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "license": "Eurostat reuse policy (acknowledgement required; adapted)",
            }
            manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True))
            log(f"fetch comext {name}: {len(body) / 1e3:.0f} kB")
            time.sleep(s.pause_seconds)
    return manifest
