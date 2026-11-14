"""Eurostat country codes shared by the Comext marts and the transport-mode marts.

Eurostat mostly uses ISO 3166 alpha-2 codes, with a few exceptions that must be translated before joining to BACI's
country file (dim_country.iso2).
"""

from __future__ import annotations

# The 27 member states (EU27_2020), in Eurostat's codes after translation (Greece as GR).
EU27 = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT",
        "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"]  # fmt: skip

# Eurostat codes that differ from ISO 3166 alpha-2: EL Greece, UK United Kingdom, XS Serbia.
# Taiwan maps to BACI's "Other Asia, nes" (S19), which has no ISO2 code, for consistency with BACI.
ISO2_FIX = {"EL": "GR", "UK": "GB", "TW": "S19", "XS": "RS"}


def to_iso2(code: str) -> str:
    """Eurostat country code -> the ISO2 code used in BACI's country file (or 'S19' for Taiwan)."""
    return ISO2_FIX.get(code, code)


def to_iso2_sql(column: str) -> str:
    """SQL expression applying :func:`to_iso2` to ``column``."""
    cases = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in ISO2_FIX.items())
    return f"CASE {column} {cases} ELSE {column} END"
