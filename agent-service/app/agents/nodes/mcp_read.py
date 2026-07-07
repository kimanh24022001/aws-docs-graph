import httpx

from app.agents.state import AgentState

MCP_ENDPOINT = "https://knowledge-mcp.global.api.aws"
MAX_CHARS = 6000


async def mcp_read_node(state: AgentState) -> AgentState:
    if state.get("question_type") == "navigation_only":
        return {**state, "mcp_read_docs": []}

    top_urls = [r.get("url") for r in state.get("mcp_results", [])[:2] if r.get("url")]
    docs = []
    try:
        async with httpx.AsyncClient() as client:
            for url in top_urls:
                try:
                    resp = await client.post(
                        f"{MCP_ENDPOINT}/read_documentation",
                        json={"url": url},
                        timeout=15,
                    )
                    resp.raise_for_status()
                    content = resp.json().get("content", "")[:MAX_CHARS]
                    docs.append({"url": url, "content": content})
                except Exception:
                    pass
    except Exception:
        pass

    return {**state, "mcp_read_docs": docs}
