"""Modelled sea routes on a hand-built network (no searoute data needed).

P0 --(10)-- A --(5, suez)-- B --(10)-- P1
            |                          |
           (40)----------- C --------(40)    (long way round, no chokepoint)
P2 --(1)-- A                                   P2 is a second gateway next to A
"""

import math

import numpy as np
import pytest

from tradegraph.routes.sea import Network, Router, classify, segments, snap

# nodes: 0=P0, 1=A, 2=B, 3=P1, 4=C, 5=P2
COORDS = np.array([[0, 0], [1, 0], [2, 0], [3, 0], [1.5, -5], [1, 0.1]], dtype=float)
EDGES = np.array([[0, 1], [1, 2], [2, 3], [1, 4], [4, 3], [5, 1]])
W = np.array([10, 5, 10, 40, 40, 1], dtype=float)
CP = [None, "suez", None, None, None, None]


@pytest.fixture
def net():
    return Network(COORDS, EDGES, W, CP)


def test_shortest_route_and_chokepoint(net):
    r = Router(net, port_nodes=np.array([0, 3]), port_snap_km=np.array([0.0, 2.0])).best([0], [1])
    assert r.km == pytest.approx(25 + 2)  # 10 + 5 + 10 plus the destination port's hop to the network
    assert r.chokepoints == ("suez",)
    assert r.edge_ids == (0, 1, 2)


def test_closure_reroutes_the_long_way(net):
    r = Router(net, np.array([0, 3]), np.array([0.0, 0.0]), closed=["suez"]).best([0], [1])
    assert r.km == pytest.approx(10 + 40 + 40)
    assert r.chokepoints == ()


def test_closure_without_alternative_is_unreachable():
    net = Network(COORDS[:4], EDGES[:3], W[:3], CP[:3])
    r = Router(net, np.array([0, 3]), np.array([0.0, 0.0]), closed=["suez"]).best([0], [1])
    assert math.isinf(r.km) and r.edge_ids == ()


def test_best_gateway_combination_and_main_port_preference(net):
    # ports: 0 -> node 0 (main), 1 -> node 5 (secondary, 9 km closer), 2 -> node 3
    nodes, snap_km, rank = np.array([0, 5, 3]), np.zeros(3), np.array([0, 1, 0])
    assert Router(net, nodes, snap_km).best([0, 1], [2]).origin_port == 1  # 16 km beats 25 km
    # with a 100% penalty per rank step the secondary port costs 16 * 2 = 32 > 25: the main port wins
    r = Router(net, nodes, snap_km, port_rank=rank, rank_penalty=1.0).best([0, 1], [2])
    assert r.origin_port == 0 and r.km == pytest.approx(25)


def test_snap_returns_great_circle_km(net):
    idx, km = snap(net, np.array([[0.0, 1.0]]))
    assert idx[0] == 0
    assert km[0] == pytest.approx(111.2, abs=0.5)  # one degree of latitude


def test_segments_merge_unbranched_chains(net):
    # used edges 0,1,2 form one chain P0-A-B-P1, but A also touches edge 3, so A is a branch point
    seg_of, paths = segments(net, [0, 1, 2, 3, 4], breakpoints=[0, 3])
    assert seg_of[1] == seg_of[2]  # A-B-P1 unbranched (B has degree 2)
    assert seg_of[0] != seg_of[1]  # A has degree 3
    assert seg_of[3] == seg_of[4]  # A-C-P1
    assert len(paths) == 3
    assert {tuple(p) for p in paths} >= {(0, 1)}


def test_segments_break_at_ports():
    net = Network(COORDS[:4], EDGES[:3], W[:3], CP[:3])
    seg_of, _ = segments(net, [0, 1, 2], breakpoints=[2])  # a route could start at node B
    assert seg_of[0] == seg_of[1] != seg_of[2]


@pytest.mark.parametrize(
    "args, expected",
    [
        ((False, False, True, 100.0, 50.0), "no_port"),
        ((True, True, True, 100.0, 50.0), "neighbour"),
        ((False, True, True, math.inf, 50.0), "no_route"),
        ((False, True, True, 4500.0, 1000.0), "overland_detour"),  # Germany-Italy-like
        ((False, True, True, 4500.0, 4000.0), "sea"),  # far apart: a detour is still shipping
        ((False, True, True, 1500.0, 1000.0), "sea"),  # sea path not a long detour
        ((False, True, True, 1500.0, None), "sea"),
    ],
)
def test_classify(args, expected):
    assert classify(*args, detour_ratio=2.0, detour_max_km=3000) == expected
