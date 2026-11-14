"""Network metrics on a directed, weighted trade graph (exporter -> importer).

Supplier centrality = PageRank on the REVERSED graph. Each importer passes importance to its
suppliers in proportion to its import shares, so a supplier ranks high when it supplies large
shares to importers that are themselves important suppliers. It's a descriptive score of
position in the observed network, not a measure of indispensability.
"""

from __future__ import annotations

import numpy as np


def pagerank(w: np.ndarray, damping: float = 0.85, tol: float = 1e-12, max_iter: int = 1000) -> np.ndarray:
    """PageRank for weight matrix ``w`` where w[a, b] is the weight of edge a -> b.

    Rows with no out-weight (dangling nodes) spread their rank uniformly. Returns scores summing to 1.
    """
    w = np.asarray(w, dtype=float)
    n = w.shape[0]
    if n == 0:
        return np.zeros(0)
    if (w < 0).any():
        raise ValueError("weights must be non-negative")
    out = w.sum(axis=1)
    dangling = out == 0
    p = np.divide(w, out[:, None], out=np.zeros_like(w), where=~dangling[:, None])
    r = np.full(n, 1.0 / n)
    for _ in range(max_iter):
        r_new = damping * (r @ p + r[dangling].sum() / n) + (1 - damping) / n
        if np.abs(r_new - r).sum() < tol:
            return r_new / r_new.sum()
        r = r_new
    return r / r.sum()


def supplier_centrality(flows: np.ndarray, damping: float = 0.85) -> np.ndarray:
    """``flows[e, i]`` = value exported by e to i. Rank flows importer -> supplier."""
    return pagerank(np.asarray(flows, dtype=float).T, damping=damping)


def communities(flows: np.ndarray, seed: int = 0, resolution: float = 1.0) -> np.ndarray:
    """Louvain communities on the undirected, value-weighted graph (w_ab = flow a->b + flow b->a).

    Returns a community id per node, numbered 0, 1, … by descending total trade of the community,
    so ids are stable and readable. Nodes without any trade get -1. These are algorithmic groupings
    of trade intensity, not political or economic blocs.
    """
    import networkx as nx

    f = np.asarray(flows, dtype=float)
    sym = f + f.T
    n = sym.shape[0]
    g = nx.Graph()
    g.add_nodes_from(range(n))
    rows, cols = np.nonzero(np.triu(sym, 1))
    g.add_weighted_edges_from((int(a), int(b), float(sym[a, b])) for a, b in zip(rows, cols, strict=True))
    comms = nx.community.louvain_communities(g, weight="weight", resolution=resolution, seed=seed)
    strength = sym.sum(axis=1)
    ranked = sorted((c for c in comms if strength[list(c)].sum() > 0), key=lambda c: -strength[list(c)].sum())
    out = np.full(n, -1, dtype=int)
    for k, c in enumerate(ranked):
        out[list(c)] = k
    return out
