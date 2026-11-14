"""Scenario V1 identities on a hand-built example.

Importer imports 120: X 60 (R=40), Y 50 (R=10), Z 10 (R=0).
Shock X by 40%: exposed = 24, share = 0.2, alternatives R = 10 (Y) + 0 (Z) = 10, coverage = 10/24.
"""

import pytest

from tradegraph.scenarios.exposure import SupplierRow, direct_exposure

ROWS = [SupplierRow("X", 60, 40), SupplierRow("Y", 50, 10), SupplierRow("Z", 10, 0)]


def test_worked_example():
    r = direct_exposure(ROWS, "X", 0.4)
    assert r.imports_kusd == 120
    assert r.exposed_kusd == pytest.approx(24)
    assert r.exposed_share_of_imports == pytest.approx(0.2)
    assert r.alternatives_redirectable_kusd == pytest.approx(10)
    assert r.coverage_ratio == pytest.approx(10 / 24)
    assert [a.supplier for a in r.alternatives] == ["Y", "Z"]  # ranked by redirectable supply


def test_shocked_supplier_excluded_from_alternatives():
    r = direct_exposure(ROWS, "Y", 1.0)
    assert "Y" not in {a.supplier for a in r.alternatives}
    assert r.alternatives_redirectable_kusd == pytest.approx(40)


@pytest.mark.parametrize("f", [0.0, 0.25, 0.5, 1.0])
def test_exposed_never_exceeds_observed(f):
    for s in ("X", "Y", "Z"):
        r = direct_exposure(ROWS, s, f)
        observed = next(x.value_kusd for x in ROWS if x.supplier == s)
        assert 0 <= r.exposed_kusd <= observed
        assert r.exposed_kusd == pytest.approx(f * observed)


def test_zero_shortfall_has_no_exposure_and_no_ratio():
    r = direct_exposure(ROWS, "X", 0.0)
    assert r.exposed_kusd == 0
    assert r.coverage_ratio is None
    assert all(a.redirectable_vs_exposed is None for a in r.alternatives)


@pytest.mark.parametrize("f", [-0.1, 1.01])
def test_shortfall_bounds(f):
    with pytest.raises(ValueError):
        direct_exposure(ROWS, "X", f)


def test_unknown_supplier():
    with pytest.raises(ValueError, match="not a recorded supplier"):
        direct_exposure(ROWS, "Q", 0.5)
