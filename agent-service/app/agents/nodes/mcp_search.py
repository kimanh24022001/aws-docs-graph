"""MCP search node using correct MCP Streamable HTTP protocol with session management."""

import json

import httpx

from app.agents.state import AgentState

MCP_BASE = "https://knowledge-mcp.global.api.aws"
MAX_RESULTS = 8


async def _init_session(client: httpx.AsyncClient) -> str | None:
    """Initialize MCP session and return session ID."""
    try:
        resp = await client.post(
            f"{MCP_BASE}/",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "aws-docs-graph", "version": "1.0"},
                },
            },
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
            timeout=10,
        )
        resp.raise_for_status()
        session_id = resp.headers.get("mcp-session-id")
        if session_id:
            # Send required initialized notification
            await client.post(
                f"{MCP_BASE}/",
                json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
                headers={"Content-Type": "application/json", "Mcp-Session-Id": session_id},
                timeout=5,
            )
        return session_id
    except Exception:
        return None


async def _search_one(client: httpx.AsyncClient, keyword: str, session_id: str) -> list[dict]:
    """Call aws___search_documentation tool with session ID."""
    try:
        resp = await client.post(
            f"{MCP_BASE}/",
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "aws___search_documentation",
                    "arguments": {"search_phrase": keyword, "limit": 4},
                },
            },
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "Mcp-Session-Id": session_id,
            },
            timeout=20,
        )
        resp.raise_for_status()

        data = resp.json()
        content = data.get("result", {}).get("content", [])
        for item in content:
            if item.get("type") == "text":
                try:
                    parsed = json.loads(item["text"])
                    # Response shape: {"content": {"result": [...]}}
                    results = parsed.get("content", {}).get("result", []) or parsed.get(
                        "results", []
                    )
                    # Normalize to {url, title, snippet} shape
                    normalized = []
                    for r in results:
                        url = r.get("url", "")
                        title = r.get("title", "")
                        snippet = r.get("context", r.get("snippet", ""))[:500]
                        service = url.split("/")[4].upper() if len(url.split("/")) > 4 else ""
                        if url:
                            normalized.append(
                                {
                                    "url": url,
                                    "title": title,
                                    "snippet": snippet,
                                    "service": service,
                                    "score": 1.0 - (r.get("rank_order", 1) - 1) * 0.1,
                                }
                            )
                    return normalized
                except Exception:
                    pass
        return []
    except Exception:
        return []


async def mcp_search_node(state: AgentState) -> AgentState:
    results = []
    try:
        async with httpx.AsyncClient() as client:
            session_id = await _init_session(client)
            if not session_id:
                raise RuntimeError("Failed to initialize MCP session")

            for kw in state["keywords"][:3]:
                results.extend(await _search_one(client, kw, session_id))

        # Deduplicate by URL
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
