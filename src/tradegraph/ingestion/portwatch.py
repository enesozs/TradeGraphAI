"""IMF PortWatch (ArcGIS FeatureServer): daily chokepoint transits plus port and chokepoint reference tables.

Licence (ADR-011): IMF Copyright and Usage, "Special Terms for Statistical Data"
(https://www.imf.org/en/about/copyright-and-terms). Non-commercial reuse, derivative works and publication
are allowed with attribution ("Source: International Monetary Fund, PortWatch, <dataset link>"), and any
material transformation must be stated. Commercial reuse needs permission (copyright@imf.org). Raw files stay
git-ignored; the app publishes only attributed, derived aggregates.

The service meters 'request units' per minute (6000 at the time of writing). A 1000-row page with all fields
can cost more than the whole quota, so we fetch small pages of selected fields, resume from the last
completed page, and back off for two minutes after a quota error.
"""

from __future__ import annotations

import csv
import hashlib
import json
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

LAYER = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0"
ITEM = "https://www.arcgis.com/sharing/rest/content/items/3da2b9ca97684916b75c4013f95d18ab?f=json"
REFERENCE_LAYERS = {
    "ports": "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/PortWatch_ports_database/FeatureServer/0",
    "chokepoints": "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/PortWatch_chokepoints_database/FeatureServer/0",
}
REFERENCE_FIELDS = ["portid", "portname", "country", "ISO3", "lat", "lon", "vessel_count_total",
                    "share_country_maritime_import", "share_country_maritime_export"]  # fmt: skip
LICENCE_URL = "https://www.imf.org/en/about/copyright-and-terms"
LICENCE_STATUS = "IMF special terms for statistical data: non-commercial reuse with attribution (ADR-011)"
PAGE = 200
PAUSE_S = 6.0
FIELDS = ["ObjectId", "date", "portid", "portname", "n_container", "n_dry_bulk", "n_general_cargo", "n_roro",
          "n_tanker", "n_cargo", "n_total", "capacity_container", "capacity_dry_bulk", "capacity_general_cargo",
          "capacity_roro", "capacity_tanker", "capacity_cargo", "capacity"]  # fmt: skip


class QuotaError(RuntimeError):
    pass


def _get(url: str, timeout: int = 90) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        d = json.load(r)
    if "error" in d:
        err = d["error"]
        if str(err.get("code")) == "429" or "quota" in str(err).lower():
            raise QuotaError(str(err))
        raise RuntimeError(str(err))
    return d


def fetch(out_dir: Path, max_minutes: float = 170, log=print) -> Path | None:
    """Resumable download. Returns the CSV path when complete, None if it ran out of time."""
    out_dir.mkdir(parents=True, exist_ok=True)
    part, state_path, dest = (
        out_dir / "daily_chokepoints.csv.part",
        out_dir / "state.json",
        out_dir / "daily_chokepoints.csv",
    )
    state = json.loads(state_path.read_text()) if state_path.exists() else {"offset": 0}
    if state["offset"] == 0:
        part.write_text(",".join(FIELDS) + "\n")
    deadline = time.time() + max_minutes * 60
    total = None
    while time.time() < deadline:
        try:
            if total is None:
                total = _get(
                    f"{LAYER}/query?" + urllib.parse.urlencode({"where": "1=1", "returnCountOnly": "true", "f": "json"})
                )["count"]
                log(f"portwatch: {total} rows; resuming at {state['offset']}")
            if state["offset"] >= total:
                break
            q = {"where": "1=1", "outFields": ",".join(FIELDS), "orderByFields": "ObjectId", "resultOffset": state["offset"],
                 "resultRecordCount": PAGE, "returnGeometry": "false", "f": "json"}  # fmt: skip
            feats = _get(f"{LAYER}/query?{urllib.parse.urlencode(q)}").get("features", [])
            with part.open("a", newline="") as fh:
                w = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore", lineterminator="\n")
                for f in feats:
                    w.writerow(f["attributes"])
            state["offset"] += len(feats)
            state_path.write_text(json.dumps(state))
            if state["offset"] % 5000 < PAGE:
                log(f"portwatch: {state['offset']}/{total}")
            time.sleep(PAUSE_S)
        except QuotaError:
            log(f"portwatch: quota hit at {state['offset']}; waiting 120 s")
            time.sleep(120)
        except Exception as e:  # noqa: BLE001 - outage: wait and retry
            log(f"portwatch: error at {state['offset']} ({str(e)[:120]}); waiting 270 s")
            time.sleep(270)
    if total is None or state["offset"] < total:
        return None
    part.replace(dest)
    state_path.unlink(missing_ok=True)
    meta = {
        "rows": total,
        "fields": FIELDS,
        "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
        "source": LAYER,
        "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "license_info": LICENCE_URL,
        "license_status": LICENCE_STATUS,
    }
    (out_dir / "manifest.json").write_text(json.dumps(meta, indent=1))
    log(f"portwatch: COMPLETE, {total} rows -> {dest}")
    return dest


def fetch_reference(out_dir: Path, log=print) -> dict[str, Path]:
    """Port and chokepoint reference tables (~2,100 rows in total, a handful of requests)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for name, layer in REFERENCE_LAYERS.items():
        rows: list[dict] = []
        while True:
            q = {"where": "1=1", "outFields": ",".join(REFERENCE_FIELDS), "orderByFields": "ObjectId",
                 "resultOffset": len(rows), "resultRecordCount": 1000, "returnGeometry": "false", "f": "json"}  # fmt: skip
            for _attempt in range(6):
                try:
                    feats = _get(f"{layer}/query?{urllib.parse.urlencode(q)}").get("features", [])
                    break
                except QuotaError:
                    log(f"portwatch {name}: quota hit; waiting 120 s")
                    time.sleep(120)
            else:
                raise RuntimeError(f"portwatch {name}: gave up after repeated quota errors")
            rows += [f["attributes"] for f in feats]
            if len(feats) < 1000:
                break
            time.sleep(PAUSE_S)
        dest = out_dir / f"{name}.csv"
        with dest.open("w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=REFERENCE_FIELDS, extrasaction="ignore", lineterminator="\n")
            w.writeheader()
            w.writerows(rows)
        meta = {"rows": len(rows), "fields": REFERENCE_FIELDS, "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
                "source": layer, "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "license_info": LICENCE_URL, "license_status": LICENCE_STATUS}  # fmt: skip
        (out_dir / f"{name}.manifest.json").write_text(json.dumps(meta, indent=1))
        log(f"portwatch {name}: {len(rows)} rows -> {dest}")
        out[name] = dest
    return out
