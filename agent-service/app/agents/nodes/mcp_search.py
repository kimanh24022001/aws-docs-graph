import httpx

from app.agents.state import AgentState

MCP_ENDPOINT = "https://knowledge-mcp.global.api.aws"
MAX_RESULTS = 8


def _search_one(client: httpx.Client, keyword: str) -> list[dict]:
    try:
        resp = client.post(
            f"{MCP_ENDPOINT}/search_documentation",
            json={"query": keyword, "max_results": 4},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("results", [])
    except Exception:
        return []


def mcp_search_node(state: AgentState) -> AgentState:
    results = []
    try:
        with httpx.Client() as client:
            for kw in state["keywords"][:3]:
                results.extend(_search_one(client, kw))
        # Deduplicate by URL, keep top MAX_RESULTS
        seen = set()
        deduped = []
        for r in results:
            url = r.get("url", "")
            if url and url not in seen:
                seen.add(url)
                deduped.append(r)
        results = deduped[:MAX_RESULTS]
    except Exception:
        results = []

    degraded = len(results) == 0
    return {
        **state,
        "mcp_results": results,
        "degraded": degraded,
        "degraded_reason": "mcp_unavailable" if degraded else state.get("degraded_reason", ""),
    }
