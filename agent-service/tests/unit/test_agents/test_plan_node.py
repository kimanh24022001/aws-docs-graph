from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.nodes.plan import _extract_keywords_fallback, plan_node


def make_state(**kwargs):
    return {
        "query_id": "q1",
        "user_id": "u1",
        "org_id": "o1",
        "question": "How do I configure S3 bucket policies?",
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
        "started_at": "",
        **kwargs,
    }


@pytest.mark.asyncio
async def test_plan_node_extracts_keywords():
    mock_msg = MagicMock()
    payload = (
        '{"keywords": ["S3", "bucket", "policy"], '
        '"expected_services": ["S3"], "question_type": "factual"}'
    )
    mock_msg.content = [MagicMock(text=payload)]
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=mock_msg)
    with patch("app.agents.nodes.plan._get_client", return_value=mock_client):
        result = await plan_node(make_state())
    assert "S3" in result["keywords"]
    assert result["question_type"] == "factual"


@pytest.mark.asyncio
async def test_plan_node_falls_back_on_error():
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(side_effect=Exception("API error"))
    with patch("app.agents.nodes.plan._get_client", return_value=mock_client):
        result = await plan_node(make_state())
    assert isinstance(result["keywords"], list)
    assert len(result["keywords"]) > 0
    assert result["question_type"] == "factual"


@pytest.mark.asyncio
async def test_plan_node_handles_invalid_question_type():
    mock_msg = MagicMock()
    mock_msg.content = [
        MagicMock(text='{"keywords": ["S3"], "expected_services": [], "question_type": "invalid"}')
    ]
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=mock_msg)
    with patch("app.agents.nodes.plan._get_client", return_value=mock_client):
        result = await plan_node(make_state())
    assert result["question_type"] == "factual"


def test_fallback_keyword_extractor():
    kws = _extract_keywords_fallback("How do I configure Lambda function timeout settings?")
    assert len(kws) > 0
    assert all(len(k) > 3 for k in kws)
