import json
import time
from contextlib import contextmanager


def emit_metric(metric_name: str, value: float, unit: str, dimensions: dict) -> None:
    """Emit a CloudWatch EMF metric via structured stdout log."""
    payload = {
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": "AwsDocsGraph",
                    "Dimensions": [list(dimensions.keys())],
                    "Metrics": [{"Name": metric_name, "Unit": unit}],
                }
            ],
        },
        metric_name: value,
        **dimensions,
    }
    print(json.dumps(payload), flush=True)


@contextmanager
def timed_metric(metric_name: str, dimensions: dict):
    """Context manager that emits a duration metric in milliseconds."""
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        emit_metric(metric_name, elapsed_ms, "Milliseconds", dimensions)
