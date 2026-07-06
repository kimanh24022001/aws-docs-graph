from app.agents.state import AgentState
from app.db.neo4j import session as neo4j_session

TRAVERSE_QUERY = """
MATCH (d:Document)
WHERE d.url IN $urls
CALL {
  WITH d
  MATCH (d)-[r:LINKS_TO|PREV_NEXT|CO_RETURNED]-(neighbor:Document)
  RETURN neighbor, r
  LIMIT 5
}
RETURN DISTINCT neighbor.id AS id, neighbor.url AS url,
       neighbor.title AS title, neighbor.service AS service
LIMIT 10
"""


async def graph_traverse_node(state: AgentState) -> AgentState:
    urls = [r.get("url") for r in state.get("mcp_results", []) if r.get("url")]
    graph_docs = []
    try:
        async with neo4j_session() as s:
            result = await s.run(TRAVERSE_QUERY, urls=urls)
            records = await result.data()
            graph_docs = [
                {"id": r["id"], "url": r["url"], "title": r["title"], "service": r["service"]}
                for r in records
            ]
    except Exception:
        graph_docs = []
        return {
            **state,
            "graph_docs": [],
            "degraded": True,
            "degraded_reason": state.get("degraded_reason") or "graph_unavailable",
        }
    return {**state, "graph_docs": graph_docs}
