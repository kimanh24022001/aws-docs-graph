"""Hybrid evidence extraction: structured parser + Ollama LLM batch job."""

import json
import logging
import re
from datetime import UTC, datetime

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session
from app.db.postgres import get_pool
from app.ingest.page import SERVICE_ALIASES as _SERVICE_ALIASES

logger = logging.getLogger(__name__)

router = APIRouter()

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.1:8b"
CONFIDENCE_THRESHOLD = 0.7

VALID_REL_TYPES = {
    "TRIGGERS",
    "INTEGRATES_WITH",
    "USES",
    "MONITORS",
    "DEPLOYS_VIA",
    "AUTHENTICATES_WITH",
    "ENCRYPTS_WITH",
    "READS_FROM",
    "WRITES_TO",
    "STORES_IN",
    "TRIGGERED_BY",
    "MONITORED_BY",
}

# HTML section header → relationship type
SECTION_PATTERNS = [
    (re.compile(r"event\s+source|trigger", re.I), "TRIGGERED_BY"),
    (re.compile(r"monitor|metric|logging|observ", re.I), "MONITORED_BY"),
    (re.compile(r"security|iam|authenticat|authoriz", re.I), "AUTHENTICATES_WITH"),
    (re.compile(r"storage|data\s+store|persist", re.I), "STORES_IN"),
    (re.compile(r"integrat|works?\s+with|use\s+with", re.I), "INTEGRATES_WITH"),
    (re.compile(r"encrypt", re.I), "ENCRYPTS_WITH"),
    (re.compile(r"deploy|provision|creat", re.I), "DEPLOYS_VIA"),
]

# Service alias lookup (reuse existing mapping, force lowercase keys and values)
_SERVICE_LOOKUP = {k.lower(): v.lower() for k, v in _SERVICE_ALIASES.items()}
# Extend with common aliases not in page.py
_EXTRA_ALIASES = {
    "cloudwatch": "cloudwatch",
    "amazon cloudwatch": "cloudwatch",
    "cloudwatch logs": "cloudwatch",
    "eventbridge": "eventbridge",
    "amazon eventbridge": "eventbridge",
    "step functions": "stepfunctions",
    "kms": "kms",
    "aws kms": "kms",
    "secrets manager": "secretsmanager",
    "amazon s3": "s3",
    "amazon ec2": "ec2",
    "amazon ecs": "ecs",
    "amazon rds": "rds",
    "amazon dynamodb": "dynamodb",
    "amazon sns": "sns",
    "amazon sqs": "sqs",
    "amazon vpc": "vpc",
    "amazon kinesis": "kinesis",
    "amazon cognito": "cognito",
    "amazon redshift": "redshift",
    "amazon elasticache": "elasticache",
    "amazon route 53": "route53",
    "aws lambda": "lambda",
    "lambda": "lambda",
    "s3": "s3",
    "ec2": "ec2",
    "ecs": "ecs",
    "rds": "rds",
    "dynamodb": "dynamodb",
    "sns": "sns",
    "sqs": "sqs",
    "vpc": "vpc",
    "kinesis": "kinesis",
    "cognito": "cognito",
    "redshift": "redshift",
    "elasticache": "elasticache",
    "apigateway": "apigateway",
    "api gateway": "apigateway",
    "amazon api gateway": "apigateway",
    "cloudformation": "cloudformation",
    "aws cloudformation": "cloudformation",
    "route53": "route53",
    "secretsmanager": "secretsmanager",
}
_SERVICE_LOOKUP.update(_EXTRA_ALIASES)


def _resolve_service(text: str) -> str | None:
    t = text.strip().lower()
    for alias in sorted(_SERVICE_LOOKUP.keys(), key=len, reverse=True):
        if alias in t:
            return _SERVICE_LOOKUP[alias]
    return None


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into overlapping chunks by word count. Skip tiny chunks."""
    words = text.split()
    if not words:
        return []
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk = " ".join(words[start:end])
        # Always keep the first chunk; skip tiny tail slivers (< 100 words) only
        # when at least one chunk has already been emitted.
        if len(words[start:end]) >= 100 or not chunks:
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


def parse_structured_sections(html: str, doc_service: str, source_url: str) -> list[dict]:
    """Extract relationships from HTML section headers + list items."""
    soup = BeautifulSoup(html, "lxml")
    main = soup.find(id="main-content") or soup.body or soup
    if not main:
        return []

    rels = []
    seen = set()

    for heading in main.find_all(["h2", "h3"]):
        heading_text = heading.get_text(strip=True)
        rel_type = None
        for pattern, rtype in SECTION_PATTERNS:
            if pattern.search(heading_text):
                rel_type = rtype
                break
        if not rel_type:
            continue

        # Collect list items in the section following the heading
        sibling = heading.find_next_sibling()
        while sibling and sibling.name not in ["h2", "h3"]:
            if sibling.name in ["ul", "ol"]:
                for li in sibling.find_all("li"):
                    service = _resolve_service(li.get_text(strip=True))
                    if service and service != doc_service:
                        key = (doc_service, rel_type, service)
                        if key not in seen:
                            seen.add(key)
                            rels.append(
                                {
                                    "src": doc_service,
                                    "rel_type": rel_type,
                                    "tgt": service,
                                    "evidence_text": f"{heading_text}: {li.get_text(strip=True)}",
                                    "source_url": source_url,
                                    "confidence": 0.85,
                                    "extraction_method": "structured_parser",
                                }
                            )
            sibling = sibling.find_next_sibling()

    return rels


async def _call_ollama(chunk: str, service: str) -> list[dict]:
    """Call Ollama API with extraction prompt. Returns list of relationship dicts."""
    rel_types_str = ", ".join(sorted(VALID_REL_TYPES))
    prompt = f"""You are extracting AWS service relationships from documentation.

Given this text from an AWS doc about {service}:
---
{chunk}
---

Extract relationships as JSON. Only extract clear, factual relationships.
Return [] if none found.

Output format:
[
  {{
    "src": "lambda",
    "rel_type": "TRIGGERS",
    "tgt": "dynamodb",
    "evidence": "exact sentence from text that shows this relationship",
    "confidence": 0.95
  }}
]

Rules:
- src and tgt must be AWS service names (lowercase, no spaces)
- rel_type must be one of: {rel_types_str}
- evidence must be a direct quote from the text (max 200 chars)
- confidence: 0.9+ for explicit statements, 0.7-0.9 for implied, skip <0.7
- Return [] if no clear relationships found
- Return ONLY the JSON array, no explanation"""

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                OLLAMA_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": 0.1},
                },
            )
            resp.raise_for_status()
            raw = resp.json().get("response", "[]")
            # Parse JSON — Ollama sometimes wraps in markdown fences
            raw = re.sub(r"```json\s*|\s*```", "", raw).strip()
            data = json.loads(raw)
            if not isinstance(data, list):
                return []
            return [
                r
                for r in data
                if isinstance(r, dict)
                and r.get("confidence", 0) >= CONFIDENCE_THRESHOLD
                and r.get("rel_type") in VALID_REL_TYPES
                and r.get("src")
                and r.get("tgt")
                and r.get("evidence")
            ]
    except Exception:
        return []


async def _upsert_evidence(
    rels: list[dict], source_url: str, source_doc_title: str
) -> tuple[int, int]:
    """Merge evidence into Neo4j. Returns (enriched, created)."""
    enriched = 0
    created = 0
    async with neo4j_session() as s:
        for r in rels:
            result = await s.run(
                """
                MATCH (a:Document {service: $src})
                  -[e:CROSS_SERVICE {rel_type: $rel_type}]->
                  (b:Document {service: $tgt})
                WHERE a.placeholder IS NULL AND b.placeholder IS NULL
                WITH e LIMIT 1
                SET e.evidence_text = $evidence_text,
                    e.source_url = $source_url,
                    e.source_doc_title = $source_doc_title,
                    e.confidence = $confidence,
                    e.extraction_method = $method
                RETURN count(e) AS updated
                """,
                src=r.get("src", ""),
                rel_type=r.get("rel_type", ""),
                tgt=r.get("tgt", ""),
                evidence_text=r.get("evidence_text") or r.get("evidence", ""),
                source_url=source_url,
                source_doc_title=source_doc_title,
                confidence=float(r.get("confidence", 0.7)),
                method=r.get("extraction_method", "llm"),
            )
            data = await result.data()
            if data and data[0]["updated"] > 0:
                enriched += 1
            else:
                # Only create new edges from structured parser — LLM edges
                # require an existing match to prevent hallucination
                if r.get("extraction_method") != "structured_parser":
                    continue
                # Create new edge if no existing match
                await s.run(
                    """
                    MATCH (a:Document {service: $src})
                    WHERE a.placeholder IS NULL
                    WITH a LIMIT 1
                    MATCH (b:Document {service: $tgt})
                    WHERE b.placeholder IS NULL
                    WITH a, b LIMIT 1
                    MERGE (a)-[e:CROSS_SERVICE {rel_type: $rel_type}]->(b)
                    ON CREATE SET e.weight = 1,
                                  e.created_at = $now,
                                  e.evidence_text = $evidence_text,
                                  e.source_url = $source_url,
                                  e.source_doc_title = $source_doc_title,
                                  e.confidence = $confidence,
                                  e.extraction_method = $method
                    ON MATCH SET  e.evidence_text = coalesce(e.evidence_text, $evidence_text),
                                  e.source_url = coalesce(e.source_url, $source_url),
                                  e.extraction_method = coalesce(e.extraction_method, $method),
                                  e.confidence = CASE WHEN $confidence > coalesce(e.confidence, 0)
                                                 THEN $confidence ELSE e.confidence END
                    """,
                    src=r.get("src", ""),
                    rel_type=r.get("rel_type", ""),
                    tgt=r.get("tgt", ""),
                    evidence_text=r.get("evidence_text") or r.get("evidence", ""),
                    source_url=source_url,
                    source_doc_title=source_doc_title,
                    confidence=float(r.get("confidence", 0.7)),
                    method=r.get("extraction_method", "llm"),
                    now=datetime.now(UTC).isoformat(),
                )
                created += 1
    return enriched, created


@router.post("/internal/graph/extract-evidence", status_code=202)
async def extract_evidence(
    limit: int = 100,
    use_llm: bool = False,
    service_filter: str = "",
):
    """Hybrid extraction: structured parser (always) + Ollama LLM (optional).

    Enriches existing CROSS_SERVICE edges with evidence, creates new ones.
    Ollama must be running at localhost:11434 when use_llm=True.
    """
    pool = await get_pool()

    query = (
        "SELECT id, url, title, service FROM app.documents "
        "WHERE status = 'active' AND title IS NOT NULL AND service IS NOT NULL"
    )
    params: list = []
    if service_filter:
        query += " AND service = $1"
        params.append(service_filter)
    params.append(limit)
    limit_param = f"${len(params)}"
    query += f" LIMIT {limit_param}"

    rows = await pool.fetch(query, *params)

    docs_processed = 0
    chunks_processed = 0
    edges_enriched = 0
    edges_created = 0
    llm_calls = 0
    errors = 0

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http_client:
        for row in rows:
            try:
                # Fetch HTML
                resp = await http_client.get(
                    row["url"], headers={"User-Agent": "aws-docs-graph/1.0"}
                )
                resp.raise_for_status()
                html = resp.text
                source_url = row["url"]
                source_title = row["title"] or ""
                service = row["service"]

                # 1. Structured parser (free)
                struct_rels = parse_structured_sections(html, service, source_url)
                for rel in struct_rels:
                    rel["source_doc_title"] = source_title
                e, c = await _upsert_evidence(struct_rels, source_url, source_title)
                edges_enriched += e
                edges_created += c

                # 2. LLM extraction (optional)
                if use_llm:
                    soup = BeautifulSoup(html, "lxml")
                    main = soup.find(id="main-content") or soup.body or soup
                    text = main.get_text(separator=" ", strip=True) if main else ""
                    chunks = chunk_text(text)
                    chunks_processed += len(chunks)

                    for chunk in chunks:
                        llm_rels = await _call_ollama(chunk, service)
                        llm_calls += 1
                        for rel in llm_rels:
                            rel["source_doc_title"] = source_title
                            rel["extraction_method"] = "llm"
                        e, c = await _upsert_evidence(llm_rels, source_url, source_title)
                        edges_enriched += e
                        edges_created += c

                docs_processed += 1
            except Exception as exc:
                logger.warning("Failed to process doc %s: %s", row.get("url", "?"), exc)
                errors += 1

    return {
        "docs_processed": docs_processed,
        "chunks_processed": chunks_processed,
        "edges_enriched": edges_enriched,
        "edges_created": edges_created,
        "llm_calls": llm_calls,
        "errors": errors,
    }
