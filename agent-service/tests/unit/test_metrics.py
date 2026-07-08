import json
import time
from unittest.mock import patch

import pytest

from app.metrics import emit_metric, timed_metric


def capture_stdout(fn, *args, **kwargs):
    """Run fn(*args, **kwargs), capture anything printed to stdout, return lines."""
    with patch("builtins.print") as mock_print:
        fn(*args, **kwargs)
    return mock_print.call_args_list


class TestEmitMetric:
    def test_emits_valid_json_to_stdout(self, capsys):
        emit_metric("query_count", 1.0, "Count", {"status": "succeeded"})
        captured = capsys.readouterr()
        payload = json.loads(captured.out.strip())
        assert payload["query_count"] == 1.0
        assert payload["status"] == "succeeded"

    def test_emf_aws_block_present(self, capsys):
        emit_metric("query_count", 1.0, "Count", {"status": "succeeded"})
        captured = capsys.readouterr()
        payload = json.loads(captured.out.strip())
        aws = payload["_aws"]
        assert aws["Namespace"] == "AwsDocsGraph"
        assert isinstance(aws["Timestamp"], int)
        assert aws["Timestamp"] > 0

    def test_emf_metrics_block(self, capsys):
        emit_metric("llm_cost_usd", 0.005, "None", {"source": "agent"})
        captured = capsys.readouterr()
        payload = json.loads(captured.out.strip())
        cw_metrics = payload["_aws"]["CloudWatchMetrics"]
        assert len(cw_metrics) == 1
        metrics_list = cw_metrics[0]["Metrics"]
        assert any(m["Name"] == "llm_cost_usd" for m in metrics_list)
        assert any(m["Unit"] == "None" for m in metrics_list)

    def test_emf_dimensions_in_payload(self, capsys):
        emit_metric("query_duration_ms", 250.0, "Milliseconds", {"question_type": "factual"})
        captured = capsys.readouterr()
        payload = json.loads(captured.out.strip())
        assert payload["question_type"] == "factual"
        dims = payload["_aws"]["CloudWatchMetrics"][0]["Dimensions"]
        assert ["question_type"] in dims

    def test_timestamp_is_milliseconds(self, capsys):
        before = int(time.time() * 1000)
        emit_metric("query_count", 1.0, "Count", {})
        after = int(time.time() * 1000)
        captured = capsys.readouterr()
        payload = json.loads(captured.out.strip())
        ts = payload["_aws"]["Timestamp"]
        assert before <= ts <= after

    def test_multiple_dimensions(self, capsys):
        emit_metric("query_count", 1.0, "Count", {"status": "succeeded", "org_id": "org1"})
        captured = capsys.readouterr()
        payload = json.loads(captured.out.strip())
        assert payload["status"] == "succeeded"
        assert payload["org_id"] == "org1"


class TestTimedMetric:
    def test_emits_duration_in_ms(self, capsys):
        with timed_metric("query_duration_ms", {"question_type": "factual"}):
            time.sleep(0.01)  # 10ms
        captured = capsys.readouterr()
        payload = json.loads(captured.out.strip())
        assert payload["query_duration_ms"] >= 10.0  # at least 10ms
        assert payload["query_duration_ms"] < 5000.0  # not absurdly large

    def test_emits_even_on_exception(self, capsys):
        with pytest.raises(ValueError):
            with timed_metric("query_duration_ms", {"question_type": "factual"}):
                raise ValueError("test error")
        captured = capsys.readouterr()
        payload = json.loads(captured.out.strip())
        assert "query_duration_ms" in payload
        assert payload["query_duration_ms"] >= 0.0

    def test_metric_unit_is_milliseconds(self, capsys):
        with timed_metric("query_duration_ms", {}):
            pass
        captured = capsys.readouterr()
        payload = json.loads(captured.out.strip())
        metrics = payload["_aws"]["CloudWatchMetrics"][0]["Metrics"]
        assert any(m["Unit"] == "Milliseconds" for m in metrics)

    def test_namespace_is_aws_docs_graph(self, capsys):
        with timed_metric("query_duration_ms", {}):
            pass
        captured = capsys.readouterr()
        payload = json.loads(captured.out.strip())
        assert payload["_aws"]["Namespace"] == "AwsDocsGraph"
