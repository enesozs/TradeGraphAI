"""L2 reallocation LP on hand-computed cases.

Country indices: 0 = shocked supplier S, 1 and 2 = alternative suppliers A and B, 3 and 4 = importers I and J.
"""

import numpy as np
import pytest

from tradegraph.scenarios.reallocation import CAPACITY_SETTINGS, Capacity, monte_carlo, reallocate


def flows(sa=(60, 40), a_exports=(0, 0, 0, 30, 70), b_exports=(0, 0, 0, 0, 0)):
    f = np.zeros((5, 5))
    f[0, 3], f[0, 4] = sa
    f[1] = a_exports
    f[2] = b_exports
    return f


def test_equal_fill_when_capacity_binds():
    # S -> I 60, S -> J 40; full shortfall -> exposed [60, 40].
    # A exports 100 (30 to I, 70 to J); alpha 0.5 -> capacity 50 -> common fill t = 50/100 = 0.5.
    res, alts, imps = reallocate(flows(), shocked=0, shortfall=1.0, cap=Capacity("t", 0.5, allow_new_links=False))
    assert list(imps) == [3, 4]
    assert res.exposed == pytest.approx([60, 40])
    assert res.fill_rate == pytest.approx(0.5)
    assert res.reallocated == pytest.approx([30, 20])
    assert res.unmet == pytest.approx([30, 20])
    assert res.capacity_used.sum() == pytest.approx(50)


def test_never_exceeds_gap_or_capacity():
    res, alts, _ = reallocate(flows(), 0, 0.5, Capacity("t", 2.0, allow_new_links=True))  # huge capacity
    assert (res.reallocated <= res.exposed + 1e-6).all()
    assert res.reallocated == pytest.approx(res.exposed)  # everything covered
    f = flows()
    cap = 2.0 * f.sum(axis=1)[alts]
    assert (res.capacity_used <= cap + 1e-6).all()


def test_no_new_links_when_not_allowed():
    # B exports only to a third country (index 1), never to I or J -> unusable without new links.
    f = flows(a_exports=(0, 0, 0, 0, 0), b_exports=(0, 100, 0, 0, 0))
    res, _, _ = reallocate(f, 0, 1.0, Capacity("t", 0.5, allow_new_links=False))
    assert res.reallocated.sum() == pytest.approx(0)
    res_new, _, _ = reallocate(f, 0, 1.0, Capacity("t", 0.5, allow_new_links=True))
    assert res_new.reallocated.sum() == pytest.approx(50)


def test_zero_shortfall_is_zero_everywhere():
    res, _, _ = reallocate(flows(), 0, 0.0, CAPACITY_SETTINGS["central"])
    assert res.exposed.sum() == 0 and res.reallocated.sum() == 0


def test_more_capacity_never_hurts():
    unmet = [reallocate(flows(), 0, 1.0, CAPACITY_SETTINGS[k])[0].unmet.sum() for k in ("low", "central", "high")]
    assert unmet[0] >= unmet[1] >= unmet[2]


def test_shortfall_bounds():
    with pytest.raises(ValueError):
        reallocate(flows(), 0, 1.5, CAPACITY_SETTINGS["central"])


def test_monte_carlo_is_deterministic_and_bounded():
    a, imps, alphas = monte_carlo(flows(), 0, 1.0, draws=20, seed=7)
    b, _, _ = monte_carlo(flows(), 0, 1.0, draws=20, seed=7)
    assert np.array_equal(a, b)
    assert a.shape == (20, 2)
    assert ((a >= -1e-6) & (a <= np.array([60, 40]) + 1e-6)).all()
    assert ((alphas >= 0.05) & (alphas <= 0.30)).all()


def test_unservable_importer_does_not_zero_everyone_else():
    # I (3) is supplied only by S; J (4) also buys from A. No new links: I can't be served, J can.
    f = np.zeros((5, 5))
    f[0, 3], f[0, 4] = 50, 50
    f[1, 4] = 100  # A exports 100, all to J
    res, _, imps = reallocate(f, 0, 1.0, Capacity("t", 0.3, allow_new_links=False))
    assert list(imps) == [3, 4]
    assert res.reallocated[0] == pytest.approx(0)  # I unservable
    assert res.reallocated[1] == pytest.approx(30)  # J gets A's full capacity (0.3 * 100)
    assert res.fill_rate == pytest.approx(30 / 50)  # equal-fill over servable importers only


def test_alpha_by_overrides_uniform_alpha():
    """Per-alternative capacity (ML A): only alternative 1 may expand, by 50% of its exports."""
    from tradegraph.scenarios.reallocation import LEARNED

    f = np.array([[0, 100, 0], [0, 0, 40], [0, 0, 0]], dtype=float)  # 0 -> 1 (shocked), 1 -> 2
    alpha_by = np.array([0.0, 0.5, 0.0])
    res, alts, imps = reallocate(f, 0, 1.0, LEARNED, alpha_by=alpha_by)
    assert list(imps) == [1]
    assert res.reallocated.sum() == pytest.approx(20.0)  # 0.5 x 40
