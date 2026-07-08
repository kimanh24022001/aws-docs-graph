from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel

from app.agents.graph import graph
from app.metrics import emit_metric, timed_metric

router = APIRouter()


class AgentRunRequest(BaseModel):
    query_id: str
    user_id: str
    org_id: str
    question: str


@router.post("/internal/agents/run")
async def run_agent(req: AgentRunRequest):
    initial_state = {
        "query_id": req.query_id,
        "user_id": req.user_id,
        "org_id": req.org_id,
        "question": req.question,
        "keywords": [],
        "expected_services": [],
        "question_type": "factual",
        "mcp_results": [],
        "graph_docs": [],
        "mcp_read_docs": [],
        "answer": "",
        "citation_ranks": [],
        "citations": [],
        "related_docs": [],
        "total_tokens": 0,
        "total_cost_usd": 0.0,
        "degraded": False,
        "degraded_reason": "",
        "truncated": False,
        "started_at": datetime.now(UTC).isoformat(),
    }

    with timed_metric("query_duration_ms", {"question_type": initial_state["question_type"]}):
        result = await graph.ainvoke(initial_state)

    emit_metric(
        "query_count",
        1,
        "Count",
        {"status": "succeeded" if not result["degraded"] else "degraded"},
    )
    emit_metric("llm_cost_usd", result["total_cost_usd"], "None", {"source": "agent"})

    return {
        "answer": result["answer"],
        "citations": result["citations"],
        "related_docs": result["related_docs"],
        "cost_breakdown": {
            "total_tokens": result["total_tokens"],
            "total_cost_usd": result["total_cost_usd"],
        },
        "agent_run_id": req.query_id,
        "query_id": req.query_id,
        "degraded": result["degraded"],
        "degraded_reason": result["degraded_reason"],
    }
