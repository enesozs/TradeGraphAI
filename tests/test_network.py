import numpy as np
import pytest

from tradegraph.metrics.network import pagerank, supplier_centrality


def test_symmetric_pair_is_equal():
    r = pagerank(np.array([[0, 1], [1, 0]]))
    assert r == pytest.approx([0.5, 0.5])


def test_sums_to_one_and_handles_dangling():
    w = np.array([[0, 2, 1], [0, 0, 0], [1, 0, 0]], dtype=float)  # node 1 is dangling
    r = pagerank(w)
    assert r.sum() == pytest.approx(1.0)
    assert (r > 0).all()


def test_star_centre_ranks_highest():
    # Every node links to node 0; node 0 links to everyone.
    n = 5
    w = np.zeros((n, n))
    w[1:, 0] = 1
    w[0, 1:] = 1
    r = pagerank(w)
    assert r.argmax() == 0
    assert r[1:] == pytest.approx([r[1]] * (n - 1))


def test_known_three_node_value():
    # Cycle 0->1->2->0: uniform stationary distribution regardless of damping.
    w = np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]])
    assert pagerank(w, damping=0.6) == pytest.approx([1 / 3] * 3)


def test_supplier_centrality_rewards_big_supplier():
    # Supplier 0 supplies 90% of both importers 1 and 2; supplier 3 supplies 10%.
    flows = np.zeros((4, 4))
    flows[0, 1], flows[3, 1] = 90, 10
    flows[0, 2], flows[3, 2] = 90, 10
    c = supplier_centrality(flows)
    assert c[0] > c[3] > 0


def test_negative_weights_rejected():
    with pytest.raises(ValueError):
        pagerank(np.array([[0, -1], [1, 0]]))


def test_communities_recover_two_blocks_and_order_by_size():
    from tradegraph.metrics.network import communities

    # Block A = {0,1,2} trades heavily internally; block B = {3,4} smaller; one weak bridge; node 5 isolated.
    f = np.zeros((6, 6))
    for a in (0, 1, 2):
        for b in (0, 1, 2):
            if a != b:
                f[a, b] = 100
    f[3, 4] = f[4, 3] = 50
    f[2, 3] = 1
    c = communities(f, seed=0)
    assert c[0] == c[1] == c[2] == 0  # biggest community gets id 0
    assert c[3] == c[4] == 1
    assert c[5] == -1  # no trade -> no community
    assert (communities(f, seed=0) == c).all()  # deterministic
