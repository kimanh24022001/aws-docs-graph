import json
import re
from datetime import UTC, datetime

import anthropic

from app.agents.state import AgentState
from app.config import settings

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


PLAN_PROMPT = """Extract search intent from this AWS question.

Return JSON only:
{
  "keywords": ["keyword1", "keyword2"],
  "expected_services": ["S3", "IAM"],
  "question_type": "factual"
}

question_type must be one of: "factual", "navigation_only", "comparison"
"""


def _extract_keywords_fallback(question: str) -> list[str]:
    words = re.findall(r"\b[A-Za-z][a-z]+(?:[A-Z][a-z]+)*\b", question)
    return list({w for w in words if len(w) > 3})[:5]


def plan_node(state: AgentState) -> AgentState:
    try:
        msg = _get_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            system=PLAN_PROMPT,
            messages=[{"role": "user", "content": state["question"]}],
        )
        data = json.loads(msg.content[0].text)
        keywords = data.get("keywords", [])
        expected_services = data.get("expected_services", [])
        question_type = data.get("question_type", "factual")
    except Exception:
        keywords = _extract_keywords_fallback(state["question"])
        expected_services = []
        question_type = "factual"

    return {
        **state,
        "keywords": keywords,
        "expected_services": expected_services,
        "question_type": question_type,
        "started_at": datetime.now(UTC).isoformat(),
        "total_tokens": 0,
        "total_cost_usd": 0.0,
        "degraded": False,
        "degraded_reason": "",
        "truncated": False,
    }
