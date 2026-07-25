from app.graph.evidence import chunk_text, parse_structured_sections


def test_chunk_text_splits_long_text():
    # 600 words → at least 2 chunks of ~500 tokens
    text = " ".join(["word"] * 600)
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    assert len(chunks) >= 2
    assert all(len(c.split()) <= 550 for c in chunks)


def test_chunk_text_short_text_returns_one_chunk():
    text = "Lambda sends logs to CloudWatch."
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    assert len(chunks) == 1


def test_chunk_text_skips_tiny_chunks():
    # A text that produces a leftover chunk < 100 tokens
    text = " ".join(["word"] * 510)
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    # All chunks must be >= 100 tokens
    assert all(len(c.split()) >= 100 for c in chunks)


TRIGGERS_HTML = """
<div id="main-content">
<h2>Event sources</h2>
<ul>
  <li>Amazon S3</li>
  <li>Amazon DynamoDB</li>
  <li>Amazon SQS</li>
</ul>
<h2>Monitoring</h2>
<ul>
  <li>Amazon CloudWatch</li>
</ul>
</div>
"""


def test_parse_structured_sections_triggers():
    rels = parse_structured_sections(
        TRIGGERS_HTML, "lambda", "https://docs.aws.amazon.com/lambda/welcome.html"
    )
    rel_types = {r["rel_type"] for r in rels}
    tgts = {r["tgt"] for r in rels}
    assert "TRIGGERED_BY" in rel_types
    assert "s3" in tgts
    assert "dynamodb" in tgts
    assert "sqs" in tgts


def test_parse_structured_sections_monitoring():
    rels = parse_structured_sections(
        TRIGGERS_HTML, "lambda", "https://docs.aws.amazon.com/lambda/welcome.html"
    )
    monitoring_rels = [r for r in rels if r["rel_type"] == "MONITORED_BY"]
    assert len(monitoring_rels) >= 1
    assert any(r["tgt"] == "cloudwatch" for r in monitoring_rels)


def test_parse_structured_sections_sets_evidence_fields():
    rels = parse_structured_sections(
        TRIGGERS_HTML, "lambda", "https://docs.aws.amazon.com/lambda/welcome.html"
    )
    for r in rels:
        assert "evidence_text" in r
        assert "source_url" in r
        assert r["source_url"] == "https://docs.aws.amazon.com/lambda/welcome.html"
        assert r["confidence"] == 0.85
        assert r["extraction_method"] == "structured_parser"
        assert r["src"] == "lambda"
