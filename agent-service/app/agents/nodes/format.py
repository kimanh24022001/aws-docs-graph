from app.agents.state import AgentState


def format_node(state: AgentState) -> AgentState:
    mcp_results = state.get("mcp_results", [])
    ranks = state.get("citation_ranks", [])

    citations = []
    for rank in ranks:
        idx = rank - 1
        if 0 <= idx < len(mcp_results):
            r = mcp_results[idx]
            citations.append(
                {
                    "rank": rank,
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "service": r.get("service", ""),
                    "snippet": r.get("snippet", ""),
                    "score": r.get("score", 0.0),
                    "source_kind": "mcp_search",
                }
            )

    related_docs = [
        {
            "title": d.get("title", ""),
            "url": d.get("url", ""),
            "service": d.get("service", ""),
            "hop_count": 1,
            "edge_path": d.get("edge_types", []),
        }
        for d in state.get("graph_docs", [])
    ]

    return {**state, "citations": citations, "related_docs": related_docs}
