import anthropic

from app.agents.state import AgentState
from app.config import settings

_client = None

SYSTEM_PROMPT = (
    "You are an AWS documentation assistant. Answer the user's question using ONLY the provided "
    "documentation excerpts. Structure your answer in this exact order:\n\n"
    "1. **Summary** — Start with a 2-3 sentence direct answer to the question. This is the "
    "TL;DR the user reads first.\n"
    "2. **Details** — Then expand with the key points, using short paragraphs or bullet points. "
    "Reference sources inline with citation numbers [1], [2], etc.\n"
    "3. **Related documentation** — End with a short '## Related documentation' section listing "
    "the source docs you used, each as a bullet with its citation number.\n\n"
    "Be concise and accurate. Never invent information not in the excerpts."
)


def _get_client():
    global _client
    if _client is None:
        import os

        # Use SAP proxy if available (ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL env vars)
        # Otherwise fall back to direct Anthropic API key
        auth_token = os.environ.get("ANTHROPIC_AUTH_TOKEN")
        base_url = os.environ.get("ANTHROPIC_BASE_URL")
        if auth_token and base_url:
            _client = anthropic.AsyncAnthropic(api_key=auth_token, base_url=base_url)
        else:
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
    seen = set()
    lines = []
    for s in sources:
        u = s.get("url", "")
        if not u or u in seen:
            continue
        seen.add(u)
        title = s.get("title") or u
        lines.append(f"- [{len(lines) + 1}] [{title}]({u})")
        if len(lines) >= 5:
            break
    answer = (
        "**Summary:** I couldn't generate a full synthesis, but the AWS documentation below "
        "is most relevant to your question.\n\n## Related documentation\n" + "\n".join(lines)
    )
    return answer, list(range(1, len(lines) + 1))


async def synthesize_node(state: AgentState) -> AgentState:
    context = _build_context(state)

    for attempt in range(2):
        try:
            msg = await _get_client().messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1500,
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
