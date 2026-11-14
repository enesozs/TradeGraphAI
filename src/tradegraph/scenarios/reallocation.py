"""Scenario V2 (L2): capacity-constrained reallocation after a supplier shortfall.

Everything here is a SCENARIO under explicit assumptions, not a forecast or causal estimate.

Setup for one basket and year (values in k USD):
  - Shocked supplier s loses a fraction f of its exports to every importer: exposure E_i = f * v(s -> i).
  - Each alternative supplier a can divert at most C_a = alpha * X_a, where X_a is a's total basket exports.
    alpha is an assumption, not an estimate of real spare capacity.
  - Importers compete for that capacity. Shipments x[a, i] >= 0 with
        sum_i x[a, i] <= C_a      (capacity of a)
        sum_a x[a, i] <= E_i      (cannot exceed the gap)
    and x[a, i] = 0 for pairs without an existing flow when new links are not allowed.

Allocation rule, two-stage (lexicographic) LP:
  1. maximise t subject to sum_a x[a, i] >= t * E_i for all i (equal fill rate, max-min fair);
  2. with t fixed, maximise sum w[a, i] * x[a, i] where w = 1 for existing links, new_link_weight otherwise.
Stage 1 prevents an arbitrary solver choice from starving some importers; stage 2 uses any leftover
capacity and prefers established relationships.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix, hstack, vstack


@dataclass(frozen=True)
class Capacity:
    name: str
    alpha: float  # share of each alternative's total basket exports that can be diverted
    allow_new_links: bool
    new_link_weight: float = 0.5


# Learned capacity (ML A): per-alternative alpha from history; new links allowed, as in "central".
LEARNED = Capacity("learned", float("nan"), allow_new_links=True)

CAPACITY_SETTINGS = {
    "low": Capacity("low", 0.05, allow_new_links=False),
    "central": Capacity("central", 0.15, allow_new_links=True),
    "high": Capacity("high", 0.30, allow_new_links=True),
}


@dataclass
class Reallocation:
    exposed: np.ndarray  # per importer
    reallocated: np.ndarray  # per importer
    flows: np.ndarray  # [n_alt, n_imp]
    fill_rate: float  # stage-1 common fill ratio t
    capacity_used: np.ndarray  # per alternative

    @property
    def unmet(self) -> np.ndarray:
        return self.exposed - self.reallocated


def reallocate(
    flows: np.ndarray, shocked: int, shortfall: float, cap: Capacity, max_alternatives: int | None = 40,
    alpha_by: np.ndarray | None = None,
) -> tuple[Reallocation, np.ndarray, np.ndarray]:  # fmt: skip
    """Solve the reallocation for one scenario.

    ``flows[e, i]`` is the observed value from exporter e to importer i. Returns the result together with
    the indices of the alternatives and of the affected importers (rows/columns of ``result.flows``).
    ``alpha_by`` (one value per exporter) replaces the uniform ``cap.alpha`` with a per-alternative share,
    e.g. the expansion learned from history (ML A).
    """
    if not 0.0 <= shortfall <= 1.0:
        raise ValueError("shortfall must be within [0, 1]")
    f = np.asarray(flows, dtype=float)
    importers = np.flatnonzero(f[shocked] > 0)
    exposed = shortfall * f[shocked, importers]
    exports = f.sum(axis=1)
    alts = np.array([a for a in np.argsort(-exports) if a != shocked and exports[a] > 0], dtype=int)
    if max_alternatives is not None:
        alts = alts[:max_alternatives]
    n_a, n_i = len(alts), len(importers)
    empty = Reallocation(exposed, np.zeros(n_i), np.zeros((n_a, n_i)), 0.0, np.zeros(n_a))
    if n_i == 0 or n_a == 0 or exposed.sum() == 0:
        return empty, alts, importers

    existing = f[np.ix_(alts, importers)] > 0
    allowed = existing | cap.allow_new_links
    pairs = np.argwhere(allowed)  # (a_idx, i_idx) for each variable
    if len(pairs) == 0:
        return empty, alts, importers
    nv = len(pairs)
    a_idx, i_idx = pairs[:, 0], pairs[:, 1]
    alpha = cap.alpha if alpha_by is None else np.asarray(alpha_by, dtype=float)[alts]
    capacity = alpha * exports[alts]
    cols = np.arange(nv)
    a_cap = coo_matrix((np.ones(nv), (a_idx, cols)), shape=(n_a, nv))  # sum_i x[a,i] <= C_a
    i_gap = coo_matrix((np.ones(nv), (i_idx, cols)), shape=(n_i, nv))  # sum_a x[a,i] <= E_i

    # Stage 1: variables [x, t]; maximise t s.t. t*E_i - sum_a x[a,i] <= 0 for every SERVABLE importer.
    # Importers with no allowed supplier at all (possible when new links are disallowed) can't be served;
    # including them would force t = 0 for everyone, so they're excluded from the equal-fill rule.
    servable = allowed.any(axis=0)
    t_target = np.where(servable, exposed, 0.0)
    t_col = coo_matrix(t_target.reshape(-1, 1))
    a1 = vstack(
        [hstack([a_cap, coo_matrix((n_a, 1))]), hstack([i_gap, coo_matrix((n_i, 1))]), hstack([-i_gap, t_col])]
    ).tocsr()
    b1 = np.concatenate([capacity, exposed, np.zeros(n_i)])
    c1 = np.zeros(nv + 1)
    c1[-1] = -1.0
    r1 = linprog(c1, A_ub=a1, b_ub=b1, bounds=[(0, None)] * nv + [(0, 1)], method="highs")
    if not r1.success:
        raise RuntimeError(f"stage-1 LP failed: {r1.message}")
    t = float(r1.x[-1])

    # Stage 2: keep every importer at >= t (minus a tiny tolerance), maximise weighted total
    w = np.where(existing[a_idx, i_idx], 1.0, cap.new_link_weight)
    a2 = vstack([a_cap, i_gap, -i_gap]).tocsr()
    b2 = np.concatenate([capacity, exposed, -(t * t_target) * (1 - 1e-9)])
    r2 = linprog(-w, A_ub=a2, b_ub=b2, bounds=[(0, None)] * nv, method="highs")
    if not r2.success:
        raise RuntimeError(f"stage-2 LP failed: {r2.message}")
    x = np.zeros((n_a, n_i))
    x[a_idx, i_idx] = np.clip(r2.x, 0, None)
    return Reallocation(exposed, x.sum(axis=0), x, t, x.sum(axis=1)), alts, importers


def monte_carlo(
    flows: np.ndarray,
    shocked: int,
    shortfall: float,
    draws: int = 100,
    seed: int = 0,
    alpha_range: tuple[float, float] = (0.05, 0.30),
    p_new_links: float = 0.5,
    max_alternatives: int | None = 40,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unmet demand per affected importer across random capacity assumptions.

    Returns (unmet[draws, n_importers], importers, alphas). Deterministic for a given seed.
    """
    rng = np.random.default_rng(seed)
    alphas = rng.uniform(*alpha_range, size=draws)
    new = rng.random(draws) < p_new_links
    out, importers = None, None
    for k in range(draws):
        res, _, importers = reallocate(
            flows, shocked, shortfall, Capacity("mc", float(alphas[k]), bool(new[k])), max_alternatives
        )
        if out is None:
            out = np.zeros((draws, len(importers)))
        out[k] = res.unmet
    return out, importers, alphas
