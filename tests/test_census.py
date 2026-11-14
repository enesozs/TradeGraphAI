"""US Census adapter: offline tests (no key, no network)."""

from pathlib import Path

import pytest

from tradegraph.ingestion.census import MissingCensusKey, api_key, parse, query_url


def test_missing_key_gives_actionable_error(tmp_path, monkeypatch):
    monkeypatch.delenv("CENSUS_API_KEY", raising=False)
    with pytest.raises(MissingCensusKey, match="key_signup"):
        api_key(tmp_path / ".env")


def test_key_read_from_env_file(tmp_path, monkeypatch):
    monkeypatch.delenv("CENSUS_API_KEY", raising=False)
    (tmp_path / ".env").write_text('OTHER=1\nCENSUS_API_KEY="abc123"\n')
    assert api_key(Path(tmp_path / ".env")) == "abc123"


def test_parse_skips_totals_and_aggregates():
    payload = [
        ["CTY_CODE", "CTY_NAME", "GEN_VAL_MO", "I_COMMODITY", "COMM_LVL", "I_COMMODITY", "time"],
        ["-", "TOTAL FOR ALL COUNTRIES", "1000", "850760", "HS6", "850760", "2024-01"],
        ["0003", "EUROPEAN UNION", "300", "850760", "HS6", "850760", "2024-01"],
        ["5700", "CHINA", "600", "850760", "HS6", "850760", "2024-01"],
        ["5800", "KOREA, SOUTH", "100", "850760", "HS6", "850760", "2024-01"],
    ]
    rows = parse(payload, "2024-01")
    assert [r["cty_name"] for r in rows] == ["CHINA", "KOREA, SOUTH"]
    assert rows[0]["value_usd"] == 600.0


def test_query_url():
    u = query_url("850760", "2024-01", "KEY")
    assert "COMM_LVL=HS6" in u and "I_COMMODITY=850760" in u and "time=2024-01" in u and "key=KEY" in u
