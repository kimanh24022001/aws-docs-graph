import anthropic

from app.agents.state import AgentState
from app.config import settings

_client = None

SYSTEM_PROMPT = (
    "You are an AWS documentation assistant. Answer the user's question using the provided "
    "documentation excerpts. Include citation numbers [1], [2] etc. when referencing sources. "
    "Be concise and accurate."
)


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


def _build_context(state: AgentState) -> str:
    parts = []
    for i, doc in enumerate(state.get("mcp_read_docs", []), 1):
        parts.append(f"[{i}] {doc['url']}\n{doc['content'][:3000]}")
    for doc in state.get("mcp_results", [])[:6]:
        parts.append(f"Source: {doc.get('url', '')} — {doc.get('snippet', '')[:500]}")
    return "\n\n".join(parts)


def _navigation_fallback(state: AgentState) -> tuple[str, list[int]]:
    sources = state.get("mcp_results", []) + state.get("graph_docs", [])
    urls = [s.get("url", "") for s in sources[:5] if s.get("url")]
    answer = "Here are the most relevant AWS documentation pages for your question:\n" + "\n".join(
        f"- {u}" for u in urls
    )
    return answer, list(range(1, len(urls) + 1))


async def synthesize_node(state: AgentState) -> AgentState:
    context = _build_context(state)

    for attempt in range(2):
        try:
            msg = await _get_client().messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                system=[
                    {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}
                ],
                messages=[
                    {
                        "role": "user",
                        "content": f"Context:\n{context}\n\nQuestion: {state['question']}",
                    }
                ],
            )
            answer = msg.content[0].text
            ranks = list(range(1, len(state.get("mcp_results", [])) + 1))
            return {
                **state,
                "answer": answer,
                "citation_ranks": ranks,
                "total_tokens": state.get("total_tokens", 0)
                + msg.usage.input_tokens
                + msg.usage.output_tokens,
            }
        except Exception:
            if attempt == 1:
                break

    answer, ranks = _navigation_fallback(state)
    return {
        **state,
        "answer": answer,
        "citation_ranks": ranks,
        "degraded": True,
        "degraded_reason": "synthesis_failed",
    }
