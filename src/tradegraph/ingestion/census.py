"""L3 (dormant until a key is configured): monthly US imports by HS6 from the US Census Bureau API.

Every request needs a free API key (https://api.census.gov/data/key_signup.html). Put it in the environment
or in a git-ignored `.env` file as CENSUS_API_KEY=... . Apps using the API must display:
"This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau."
"""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.census.gov/data/timeseries/intltrade/imports/hs"
FIELDS = ["CTY_CODE", "CTY_NAME", "GEN_VAL_MO", "I_COMMODITY"]
NOTICE = "This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau."


class MissingCensusKey(RuntimeError):
    pass


def api_key(env_file: Path = Path(".env")) -> str:
    key = os.environ.get("CENSUS_API_KEY")
    if not key and env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.strip().startswith("CENSUS_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise MissingCensusKey(
            "US monthly data needs a free Census API key: sign up at https://api.census.gov/data/key_signup.html "
            "and add CENSUS_API_KEY=... to a local .env file (never commit it)."
        )
    return key


def query_url(product: str, month: str, key: str) -> str:
    params = {"get": ",".join(FIELDS), "COMM_LVL": "HS6", "I_COMMODITY": product, "time": month, "key": key}
    return f"{API}?{urllib.parse.urlencode(params)}"


def parse(payload: list[list[str]], month: str) -> list[dict]:
    """The API returns a JSON array whose first row is the header."""
    header, *body = payload
    idx = {name: k for k, name in enumerate(header)}
    out = []
    for r in body:
        code = r[idx["CTY_CODE"]]
        if not code.isdigit() or code.startswith("0") or int(code) < 1000:  # skip totals and regional aggregates
            continue
        out.append({"month": month, "product": r[idx["I_COMMODITY"]], "cty_code": code,
                    "cty_name": r[idx["CTY_NAME"]], "value_usd": float(r[idx["GEN_VAL_MO"]] or 0)})  # fmt: skip
    return out


def fetch(products: list[str], months: list[str], out: Path, pause: float = 0.5, log=print) -> Path:
    key = api_key()
    rows: list[dict] = []
    for p in products:
        for m in months:
            with urllib.request.urlopen(query_url(p, m, key), timeout=120) as r:
                body = r.read()
            if not body.strip():  # the API answers 204/empty when there is no trade
                continue
            rows.extend(parse(json.loads(body), m))
            time.sleep(pause)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"notice": NOTICE, "rows": rows}))
    log(f"census: {len(rows)} rows -> {out}")
    return out
