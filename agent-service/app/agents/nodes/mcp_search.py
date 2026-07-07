import httpx

from app.agents.state import AgentState

MCP_ENDPOINT = "https://knowledge-mcp.global.api.aws"
MAX_RESULTS = 8


async def _search_one(client: httpx.AsyncClient, keyword: str) -> list[dict]:
    try:
        resp = await client.post(
            f"{MCP_ENDPOINT}/search_documentation",
            json={"query": keyword, "max_results": 4},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("results", [])
    except Exception:
        return []


async def mcp_search_node(state: AgentState) -> AgentState:
    results = []
    try:
        async with httpx.AsyncClient() as client:
            for kw in state["keywords"][:3]:
                results.extend(await _search_one(client, kw))
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
