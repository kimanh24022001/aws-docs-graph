from typing import TypedDict


class AgentState(TypedDict):
    query_id: str
    user_id: str
    org_id: str
    question: str
    question_type: str  # "factual" | "navigation_only" | "comparison"
    keywords: list[str]
    expected_services: list[str]
    mcp_results: list[dict]  # raw MCP search results
    graph_docs: list[dict]  # docs from graph traversal
    mcp_read_docs: list[dict]  # full doc content from mcp_read
    answer: str
    citation_ranks: list[int]
    citations: list[dict]
    related_docs: list[dict]
    total_tokens: int
    total_cost_usd: float
    degraded: bool
    degraded_reason: str
    truncated: bool
    started_at: str
