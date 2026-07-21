from app.graph.clustering import community_label, compute_communities


def test_compute_communities_assigns_all_nodes():
    # 4 nodes: 2 clusters (0-1 connected, 2-3 connected)
    nodes = ["a", "b", "c", "d"]
    edges = [("a", "b"), ("b", "a"), ("c", "d"), ("d", "c")]
    result = compute_communities(nodes, edges)
    assert set(result.keys()) == {"a", "b", "c", "d"}
    # nodes a,b should share a community; c,d should share a community
    assert result["a"] == result["b"]
    assert result["c"] == result["d"]
    assert result["a"] != result["c"]


def test_compute_communities_single_node():
    result = compute_communities(["x"], [])
    assert result == {"x": 0}


def test_community_label_uses_dominant_service():
    # community 5 has nodes with services: s3, s3, lambda
    node_services = {"n1": "s3", "n2": "s3", "n3": "lambda"}
    partition = {"n1": 5, "n2": 5, "n3": 5}
    label = community_label(5, partition, node_services)
    assert label == "s3"


def test_community_label_empty_community():
    label = community_label(99, {}, {})
    assert label == "community-99"
