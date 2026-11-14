"""Fetch a World Bank WDI indicator (default: GDP, current US$) for all economies.

Licence: CC BY 4.0. Attribution required; no implied World Bank endorsement.
"""

from __future__ import annotations

import json
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from tradegraph.config import WdiSettings

API = "https://api.worldbank.org/v2/country/all/indicator/{ind}?date={y0}:{y1}&format=json&per_page=20000&page={page}"


def fetch(s: WdiSettings, data_dir: Path, log=print) -> Path:
    rows: list[dict] = []
    page, pages = 1, 1
    while page <= pages:
        url = API.format(ind=s.indicator, y0=s.years[0], y1=s.years[1], page=page)
        with urllib.request.urlopen(url, timeout=120) as r:
            meta, data = json.load(r)
        pages = int(meta["pages"])
        rows.extend(data or [])
        page += 1
    out = data_dir / "raw" / "wdi" / f"{s.indicator}_{s.years[0]}_{s.years[1]}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "indicator": s.indicator,
                "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "source": "World Bank, World Development Indicators",
                "license": "CC BY 4.0",
                "rows": rows,
            }
        )
    )
    log(f"wdi   {s.indicator}: {len(rows)} rows -> {out}")
    return out
