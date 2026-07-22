from collections import Counter

import community as community_louvain
import networkx as nx
from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session

router = APIRouter()


def compute_communities(nodes: list[str], edges: list[tuple[str, str]]) -> dict[str, int]:
    """Run Louvain on a node/edge list. Returns {node_id: community_id}."""
    G = nx.Graph()
    G.add_nodes_from(nodes)
    G.add_edges_from(edges)
    if len(G.nodes) == 0:
        return {}
    if len(G.edges) == 0:
        return {n: i for i, n in enumerate(nodes)}
    return community_louvain.best_partition(G)


def community_label(
    community_id: int,
    partition: dict[str, int],
    node_services: dict[str, str],
) -> str:
    """Derive a human-readable label from the dominant service in a community."""
    services = [
        node_services.get(n, "")
        for n, cid in partition.items()
        if cid == community_id and node_services.get(n)
    ]
    if not services:
        return f"community-{community_id}"
    dominant = Counter(services).most_common(1)[0][0]
    return dominant


@router.post("/internal/graph/run-clustering", status_code=202)
async def run_clustering():
    """Load Document graph into networkx, run Louvain, write community_id back to Neo4j.

    Triggered weekly by EventBridge cron (Mondays 02:00 UTC via ingest-cron Lambda).
    Also callable manually: POST /internal/graph/run-clustering
    """
    async with neo4j_session() as s:
        # Load all real (non-placeholder) Document nodes
        result = await s.run(
            "MATCH (d:Document) WHERE d.placeholder IS NULL OR d.placeholder = false "
            "RETURN d.id AS id, d.service AS service"
        )
        records = await result.data()

    nodes = [r["id"] for r in records if r["id"]]
    node_services = {r["id"]: (r["service"] or "") for r in records if r["id"]}

    async with neo4j_session() as s:
        # Load LINKS_TO edges between real nodes
        result = await s.run(
            "MATCH (a:Document)-[:LINKS_TO]->(b:Document) "
            "WHERE a.placeholder IS NULL AND b.placeholder IS NULL "
            "AND a.id IS NOT NULL AND b.id IS NOT NULL "
            "RETURN a.id AS src, b.id AS tgt"
        )
        edge_records = await result.data()

    edges = [(r["src"], r["tgt"]) for r in edge_records]
    partition = compute_communities(nodes, edges)

    # Write community_id back to Neo4j in batches of 500
    batch_size = 500
    items = list(partition.items())
    async with neo4j_session() as s:
        for i in range(0, len(items), batch_size):
            batch = items[i : i + batch_size]
            assignments = [
                {
                    "id": node_id,
                    "community_id": f"community-{cid}",
                    "community_label": community_label(cid, partition, node_services),
                }
                for node_id, cid in batch
            ]
            await s.run(
                "UNWIND $rows AS row "
                "MATCH (d:Document {id: row.id}) "
                "SET d.community_id = row.community_id, "
                "    d.community_label = row.community_label",
                rows=assignments,
            )

    return {"communities": len(set(partition.values())), "nodes_assigned": len(partition)}
