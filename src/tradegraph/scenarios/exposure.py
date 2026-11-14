"""Scenario V1: direct exposure + observed redirectable supply (BLUEPRINT §8).

Everything here is observed data plus ONE explicit assumption, the shortfall fraction f.
Outputs are labelled SCENARIO and are not forecasts or causal estimates.
The site's JavaScript (site/src/index.md, "Exposure scenario") mirrors this reference
implementation; keep the two in sync.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SupplierRow:
    supplier: str
    value_kusd: float
    redirectable_kusd: float  # supplier's basket exports to all OTHER destinations


@dataclass(frozen=True)
class Alternative:
    supplier: str
    current_kusd: float
    redirectable_kusd: float
    redirectable_vs_exposed: float | None  # R / exposed, None when exposed == 0


@dataclass(frozen=True)
class ExposureResult:
    shocked_supplier: str
    shortfall: float
    imports_kusd: float
    exposed_kusd: float
    exposed_share_of_imports: float
    alternatives_redirectable_kusd: float
    coverage_ratio: float | None  # sum of alternatives' R / exposed; None when exposed == 0
    alternatives: list[Alternative]


def direct_exposure(rows: list[SupplierRow], shocked: str, shortfall: float) -> ExposureResult:
    if not 0.0 <= shortfall <= 1.0:
        raise ValueError("shortfall must be within [0, 1]")
    by_name = {r.supplier: r for r in rows}
    if shocked not in by_name:
        raise ValueError(f"{shocked!r} is not a recorded supplier of this importer/basket/year")
    imports = sum(r.value_kusd for r in rows)
    exposed = by_name[shocked].value_kusd * shortfall
    alts = sorted((r for r in rows if r.supplier != shocked), key=lambda r: -r.redirectable_kusd)
    total_r = sum(r.redirectable_kusd for r in alts)
    return ExposureResult(
        shocked_supplier=shocked,
        shortfall=shortfall,
        imports_kusd=imports,
        exposed_kusd=exposed,
        exposed_share_of_imports=exposed / imports if imports else 0.0,
        alternatives_redirectable_kusd=total_r,
        coverage_ratio=total_r / exposed if exposed else None,
        alternatives=[
            Alternative(
                supplier=r.supplier,
                current_kusd=r.value_kusd,
                redirectable_kusd=r.redirectable_kusd,
                redirectable_vs_exposed=r.redirectable_kusd / exposed if exposed else None,
            )
            for r in alts
        ],
    )
