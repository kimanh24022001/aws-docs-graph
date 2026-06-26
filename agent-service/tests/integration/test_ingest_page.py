"""Integration tests for page ingest — uses real Postgres via Testcontainers."""

import uuid

import pytest

from app.ingest.page import parse_page, upsert_document

SAMPLE_HTML = """
<html><head><title>S3 buckets - Amazon S3</title></head>
<body><div id="main-content">
  <p>Learn about <a href="https://docs.aws.amazon.com/s3/buckets.html">creating buckets</a>.</p>
</div></body></html>
"""
SAMPLE_URL = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingBucket.html"


@pytest.mark.asyncio
async def test_upsert_creates_new_document(pg_pool):
    """First insert of a URL returns outcome='new' and persists the document."""
    parsed = parse_page(SAMPLE_URL, SAMPLE_HTML)
    run_id = uuid.uuid4()
    doc_id, outcome = await upsert_document(pg_pool, parsed, run_id)

    assert outcome == "new"
    row = await pg_pool.fetchrow("SELECT url, service FROM app.documents WHERE id = $1", doc_id)
    assert row["url"] == SAMPLE_URL
    assert row["service"] == "AMAZONS3"


@pytest.mark.asyncio
async def test_upsert_idempotent_unchanged(pg_pool):
    """Second upsert with identical content returns the same doc_id and outcome='unchanged'."""
    parsed = parse_page(SAMPLE_URL, SAMPLE_HTML)
    run_id = uuid.uuid4()
    doc_id, _ = await upsert_document(pg_pool, parsed, run_id)

    # Second call with same content
    doc_id2, outcome2 = await upsert_document(pg_pool, parsed, uuid.uuid4())
    assert doc_id == doc_id2
    assert outcome2 == "unchanged"


@pytest.mark.asyncio
async def test_upsert_detects_change(pg_pool):
    """Second upsert with different title returns outcome='updated'."""
    url = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/ChangeTest.html"
    html_v1 = SAMPLE_HTML.replace("S3 buckets", "S3 buckets v1")
    html_v2 = SAMPLE_HTML.replace("S3 buckets", "S3 buckets v2")

    parsed_v1 = parse_page(url, html_v1)
    parsed_v2 = parse_page(url, html_v2)

    await upsert_document(pg_pool, parsed_v1, uuid.uuid4())
    _, outcome = await upsert_document(pg_pool, parsed_v2, uuid.uuid4())
    assert outcome == "updated"


@pytest.mark.asyncio
async def test_crawl_log_written(pg_pool):
    """upsert_document writes a row to app.crawl_log for the run_id."""
    url = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/CrawlLog.html"
    html = SAMPLE_HTML  # content doesn't reference this URL so no self-link issue
    parsed = parse_page(url, html)
    run_id = uuid.uuid4()
    await upsert_document(pg_pool, parsed, run_id)

    row = await pg_pool.fetchrow(
        "SELECT outcome FROM app.crawl_log WHERE url = $1 AND run_id = $2",
        url,
        run_id,
    )
    assert row is not None
    assert row["outcome"] == "new"
