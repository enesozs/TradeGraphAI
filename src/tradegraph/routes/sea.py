"""Modelled sea routes between countries over the searoute maritime network (Eurostat MARNET).

This is a MODEL, not observed shipping: each country pair is linked through its main ports (by PortWatch
share of the country's maritime trade) along the shortest path of the network. Passages ('suez', 'panama',
...) are tags on network edges. Closing a passage removes its edges and recomputes the shortest path.

Everything here is pure (no I/O) so it can be tested on a hand-built network.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

EARTH_KM = 6371.0088

# searoute passage tag -> chokepoint key shown in the app (Dardanelles + Bosporus are one strait system).
PASSAGE_CHOKEPOINT = {
    "suez": "suez",
    "panama": "panama",
    "babalmandab": "bab_el_mandeb",
    "ormuz": "hormuz",
    "malacca": "malacca",
    "sunda": "sunda",
    "gibraltar": "gibraltar",
    "bosporus": "turkish_straits",
    "dardanelles": "turkish_straits",
    "south_africa": "cape_of_good_hope",
    "chili": "cape_horn_magellan",
    "bering": "bering",
}
ALWAYS_CLOSED = ("northwest",)  # searoute's default: the Northwest Passage is not a commercial lane


@dataclass(frozen=True)
class Network:
    """Undirected maritime network. Node coordinates are (lon, lat); edge weights in km."""

    coords: np.ndarray  # (N, 2) lon, lat
    edges: np.ndarray  # (E, 2) node indices
    weight_km: np.ndarray  # (E,)
    chokepoint: list[str | None]  # (E,) chokepoint key or None

    @classmethod
    def from_graph(cls, g) -> Network:
        """Build from a networkx-style graph whose nodes are (lon, lat) tuples (searoute's Marnet)."""
        nodes = list(g.nodes)
        index = {n: i for i, n in enumerate(nodes)}
        e, w, c = [], [], []
        for u, v, d in g.edges(data=True):
            p = d.get("passage")
            if p in ALWAYS_CLOSED:
                continue
            e.append((index[u], index[v]))
            w.append(float(d["weight"]))
            c.append(PASSAGE_CHOKEPOINT.get(p))
        return cls(np.array(nodes, dtype=float), np.array(e, dtype=np.int64), np.array(w), c)

    def matrix(self, closed: Iterable[str] = ()) -> csr_matrix:
        closed = set(closed)
        keep = np.array([c not in closed for c in self.chokepoint], dtype=bool)
        n = len(self.coords)
        e, w = self.edges[keep], self.weight_km[keep]
        # tiny positive floor: csgraph treats explicit zeros as missing edges
        w = np.maximum(w, 1e-6)
        return csr_matrix((np.r_[w, w], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n))


def _unit(lonlat: np.ndarray) -> np.ndarray:
    lon, lat = np.radians(lonlat[:, 0]), np.radians(lonlat[:, 1])
    return np.c_[np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)]


def snap(net: Network, points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Nearest network node (great-circle) for each (lon, lat) point; returns (node index, distance km)."""
    tree = cKDTree(_unit(net.coords))
    chord, idx = tree.query(_unit(np.asarray(points, dtype=float)))
    return idx, 2 * EARTH_KM * np.arcsin(np.clip(chord / 2, 0, 1))


@dataclass(frozen=True)
class Route:
    origin_port: int  # index into the ports list
    dest_port: int
    km: float  # inf when unreachable
    chokepoints: tuple[str, ...]  # in travel order, de-duplicated
    edge_ids: tuple[int, ...]


class Router:
    """Shortest routes between sets of ports for one network state (base or with chokepoints closed)."""

    def __init__(self, net: Network, port_nodes: np.ndarray, port_snap_km: np.ndarray, closed: Sequence[str] = (),
                 port_rank: np.ndarray | None = None, rank_penalty: float = 0.0):  # fmt: skip
        self.net, self.closed = net, tuple(closed)
        self.port_nodes, self.port_snap_km = np.asarray(port_nodes), np.asarray(port_snap_km)
        # A country's secondary gateways must be clearly shorter to win: cost = km * (1 + penalty * rank).
        self.port_rank = np.zeros(len(self.port_nodes)) if port_rank is None else np.asarray(port_rank, dtype=float)
        self.rank_penalty = rank_penalty
        src = np.unique(self.port_nodes)
        self._row = {int(n): i for i, n in enumerate(src)}
        self.dist, self.pred = dijkstra(net.matrix(closed), directed=False, indices=src, return_predecessors=True)
        lookup = {}
        for k, (u, v) in enumerate(net.edges):
            if net.chokepoint[k] in self.closed:
                continue
            key = (min(u, v), max(u, v))
            if key not in lookup or net.weight_km[k] < net.weight_km[lookup[key]]:
                lookup[key] = k
        self._edge = lookup

    def port_km(self, a: int, b: int) -> float:
        """Sea distance between two ports (by index), including the hops to and from the network."""
        d = self.dist[self._row[int(self.port_nodes[a])], self.port_nodes[b]]
        return float(d + self.port_snap_km[a] + self.port_snap_km[b])

    def best(self, origin_ports: Sequence[int], dest_ports: Sequence[int]) -> Route:
        """Shortest route over every origin-port x destination-port combination (main ports preferred)."""
        best = (np.inf, np.inf, -1, -1)
        for a in origin_ports:
            for b in dest_ports:
                d = self.port_km(a, b)
                cost = d * (1 + self.rank_penalty * (self.port_rank[a] + self.port_rank[b]))
                if cost < best[0]:
                    best = (cost, d, a, b)
        _, km, a, b = best
        if not np.isfinite(km):
            return Route(-1, -1, float("inf"), (), ())
        return Route(a, b, km, *self._path(a, b))

    def _path(self, a: int, b: int) -> tuple[tuple[str, ...], tuple[int, ...]]:
        row, node, target = self._row[int(self.port_nodes[a])], int(self.port_nodes[b]), int(self.port_nodes[a])
        edges: list[int] = []
        while node != target:
            prev = int(self.pred[row, node])
            edges.append(self._edge[(min(prev, node), max(prev, node))])
            node = prev
        edges.reverse()
        seen: list[str] = []
        for k in edges:
            c = self.net.chokepoint[k]
            if c and c not in seen:
                seen.append(c)
        return tuple(seen), tuple(edges)


def segments(
    net: Network, edge_ids: Iterable[int], breakpoints: Iterable[int] = ()
) -> tuple[dict[int, int], list[list[int]]]:
    """Merge used edges into maximal unbranched chains ("lane segments").

    Inside a chain every node has degree 2 in the used subgraph and is not a breakpoint (a port node where routes
    start or end), so every route that uses one edge of a chain uses all of it: loads per segment are exact.
    Returns (edge -> segment id, segment -> ordered node path).
    """
    used = sorted(set(edge_ids))
    adj: dict[int, list[tuple[int, int]]] = {}
    for k in used:
        u, v = (int(x) for x in net.edges[k])
        adj.setdefault(u, []).append((v, k))
        adj.setdefault(v, []).append((u, k))
    stop = set(breakpoints)
    is_end = lambda n: len(adj[n]) != 2 or n in stop  # noqa: E731
    seg_of: dict[int, int] = {}
    paths: list[list[int]] = []

    def walk(start: int, nxt: int, k: int) -> None:
        sid, path, cur, last = len(paths), [start, nxt], nxt, k
        seg_of[k] = sid
        while not is_end(cur):
            n, kk = next((n, kk) for n, kk in adj[cur] if kk != last)
            if kk in seg_of:  # closed loop
                break
            seg_of[kk] = sid
            cur, last = n, kk
            path.append(cur)
        paths.append(path)

    for n in adj:
        if is_end(n):
            for m, k in adj[n]:
                if k not in seg_of:
                    walk(n, m, k)
    for k in used:  # pure cycles without an end node
        if k not in seg_of:
            u, v = (int(x) for x in net.edges[k])
            walk(u, v, k)
    return seg_of, paths


def classify(contig: bool, has_ports: bool, partner_has_ports: bool, sea_km: float, dist_km: float | None,
             detour_ratio: float, detour_max_km: float) -> str:  # fmt: skip
    """Mode class of a country pair under the model's simple, documented rules (ADR-011).

    - 'no_port': either side has no seaport in PortWatch (mostly landlocked) -> not modelled.
    - 'neighbour': the countries share a border (CEPII contig) -> assumed mostly overland.
    - 'overland_detour': close by land but the sea path is a long detour (e.g. Germany-Italy) -> overland.
    - 'no_route': the network cannot connect the ports.
    - 'sea': modelled sea route.
    """
    if not (has_ports and partner_has_ports):
        return "no_port"
    if contig:
        return "neighbour"
    if not np.isfinite(sea_km):
        return "no_route"
    if dist_km is not None and dist_km < detour_max_km and sea_km > detour_ratio * dist_km:
        return "overland_detour"
    return "sea"
