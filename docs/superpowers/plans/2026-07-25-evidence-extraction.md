# Evidence-first Extraction Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hybrid extraction pipeline (structured parser + Ollama LLM) that enriches CROSS_SERVICE edges in Neo4j with evidence text, source URL, and confidence score, then expose this via a Java API endpoint and a frontend evidence panel on edge click.

**Architecture:** Python batch job parses HTML sections (free) then calls local Ollama llama3.1:8b for prose chunks, enriching existing CROSS_SERVICE edges with evidence properties. Java serves a new `/v1/graph/evidence` endpoint. React Three Fiber galaxy shows an evidence panel when user clicks an edge.

**Tech Stack:** Python 3.12 + BeautifulSoup + httpx (Ollama HTTP) | Java 21 + Spring Boot 3 + neo4j-java-driver | React + Three.js + @react-three/fiber

## Global Constraints

- Ollama runs at `http://localhost:11434` — must be running before extraction job
- Model: `llama3.1:8b` — must be pulled before first run
- LLM temperature: `0.1` (deterministic extraction)
- Chunk size: 500 tokens, 50-token overlap, skip chunks < 100 tokens
- Edge type: `CROSS_SERVICE` — enrich existing, create new (never delete existing)
- New edge properties: `evidence_text` (String), `source_url` (String), `source_doc_title` (String), `confidence` (Float 0.0–1.0), `extraction_method` ("llm" | "structured_parser" | "rule_based")
- Confidence threshold: skip relationships with confidence < 0.7
- Python service: `agent-service/`, venv at `agent-service/.venv/`
- Java service: `api-service/`, port 8083 locally
- Working directory: `/Users/I753472/Documents/development/aws-docs-graph`

---

## File Structure

```
agent-service/app/graph/
├── evidence.py              NEW — structured parser + Ollama extractor + FastAPI endpoint
tests/unit/test_graph/
└── test_evidence.py         NEW — unit tests for parser and chunk logic

api-service/src/main/java/com/awsdocs/
├── adapter/in/rest/GalaxyController.java    MODIFY — add GET /v1/graph/evidence
├── application/port/out/GraphRepository.java MODIFY — add getEvidence()
└── adapter/out/graph/Neo4jGraphClient.java   MODIFY — implement getEvidence()

web/app/galaxy/
└── page.tsx                 MODIFY — add onLinkClick handler + EvidencePanel state

web/components/
└── EvidencePanel.tsx        NEW — evidence panel component

web/lib/
└── api.ts                   MODIFY — add fetchEvidence()
```

---

### Task 1: Install Ollama + verify structured parser helpers

**Files:**
- Create: `agent-service/app/graph/evidence.py` (parser + Ollama client + endpoint)
- Create: `agent-service/tests/unit/test_graph/test_evidence.py`
- Modify: `agent-service/app/main.py` — register evidence router

**Interfaces:**
- Produces:
  - `chunk_text(html: str, chunk_size: int = 500, overlap: int = 50) -> list[str]`
  - `parse_structured_sections(html: str, doc_service: str, source_url: str) -> list[dict]`
  - `POST /internal/graph/extract-evidence` → `{"docs_processed": int, "edges_enriched": int, "edges_created": int, "llm_calls": int, "errors": int}`

- [ ] **Step 1: Install Ollama**

```bash
brew install ollama
ollama pull llama3.1:8b
# Start server in a separate terminal:
ollama serve
```

Verify:
```bash
curl http://localhost:11434/api/tags | python3 -m json.tool | grep llama3.1
```
Expected: `"llama3.1:8b"` listed.

- [ ] **Step 2: Write failing unit tests**

Create `agent-service/tests/unit/test_graph/test_evidence.py`:
```python
import pytest
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
    rels = parse_structured_sections(TRIGGERS_HTML, "lambda", "https://docs.aws.amazon.com/lambda/welcome.html")
    rel_types = {r["rel_type"] for r in rels}
    tgts = {r["tgt"] for r in rels}
    assert "TRIGGERED_BY" in rel_types
    assert "s3" in tgts
    assert "dynamodb" in tgts
    assert "sqs" in tgts


def test_parse_structured_sections_monitoring():
    rels = parse_structured_sections(TRIGGERS_HTML, "lambda", "https://docs.aws.amazon.com/lambda/welcome.html")
    monitoring_rels = [r for r in rels if r["rel_type"] == "MONITORED_BY"]
    assert len(monitoring_rels) >= 1
    assert any(r["tgt"] == "cloudwatch" for r in monitoring_rels)


def test_parse_structured_sections_sets_evidence_fields():
    rels = parse_structured_sections(TRIGGERS_HTML, "lambda", "https://docs.aws.amazon.com/lambda/welcome.html")
    for r in rels:
        assert "evidence_text" in r
        assert "source_url" in r
        assert r["source_url"] == "https://docs.aws.amazon.com/lambda/welcome.html"
        assert r["confidence"] == 0.85
        assert r["extraction_method"] == "structured_parser"
        assert r["src"] == "lambda"
```

- [ ] **Step 3: Run tests — verify FAIL**

```bash
cd agent-service && source .venv/bin/activate
pytest tests/unit/test_graph/test_evidence.py -v
```
Expected: `ERROR` — `app.graph.evidence` not found.

- [ ] **Step 4: Implement `evidence.py`**

Create `agent-service/app/graph/evidence.py`:
```python
"""Hybrid evidence extraction: structured parser + Ollama LLM batch job."""

import json
import re
from datetime import UTC, datetime

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session
from app.db.postgres import get_pool
from app.ingest.page import SERVICE_ALIASES

router = APIRouter()

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.1:8b"
CONFIDENCE_THRESHOLD = 0.7

VALID_REL_TYPES = {
    "TRIGGERS", "INTEGRATES_WITH", "USES", "MONITORS",
    "DEPLOYS_VIA", "AUTHENTICATES_WITH", "ENCRYPTS_WITH",
    "READS_FROM", "WRITES_TO", "STORES_IN", "TRIGGERED_BY", "MONITORED_BY",
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

# Service alias lookup (reuse existing mapping)
_SERVICE_LOOKUP = {k.lower(): v for k, v in SERVICE_ALIASES.items()}
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
        if len(words[start:end]) >= 100:
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
                            rels.append({
                                "src": doc_service,
                                "rel_type": rel_type,
                                "tgt": service,
                                "evidence_text": f"{heading_text}: {li.get_text(strip=True)}",
                                "source_url": source_url,
                                "confidence": 0.85,
                                "extraction_method": "structured_parser",
                            })
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
                r for r in data
                if isinstance(r, dict)
                and r.get("confidence", 0) >= CONFIDENCE_THRESHOLD
                and r.get("rel_type") in VALID_REL_TYPES
                and r.get("src") and r.get("tgt")
                and r.get("evidence")
            ]
    except Exception:
        return []


async def _upsert_evidence(rels: list[dict], source_url: str, source_doc_title: str) -> tuple[int, int]:
    """Merge evidence into Neo4j. Returns (enriched, created)."""
    enriched = 0
    created = 0
    async with neo4j_session() as s:
        for r in rels:
            result = await s.run(
                """
                MATCH (a:Document {service: $src})-[e:CROSS_SERVICE {rel_type: $rel_type}]->(b:Document {service: $tgt})
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
    use_llm: bool = True,
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
    query += f" LIMIT {limit}"

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
            except Exception:
                errors += 1

    return {
        "docs_processed": docs_processed,
        "chunks_processed": chunks_processed,
        "edges_enriched": edges_enriched,
        "edges_created": edges_created,
        "llm_calls": llm_calls,
        "errors": errors,
    }
```

- [ ] **Step 5: Register router in main.py**

In `agent-service/app/main.py`, add:
```python
from app.graph.evidence import router as evidence_router
# in app setup:
app.include_router(evidence_router)
```

- [ ] **Step 6: Run tests — verify PASS**

```bash
cd agent-service && source .venv/bin/activate
pytest tests/unit/test_graph/test_evidence.py -v
```

Expected:
```
test_evidence.py::test_chunk_text_splits_long_text PASSED
test_evidence.py::test_chunk_text_short_text_returns_one_chunk PASSED
test_evidence.py::test_chunk_text_skips_tiny_chunks PASSED
test_evidence.py::test_parse_structured_sections_triggers PASSED
test_evidence.py::test_parse_structured_sections_monitoring PASSED
test_evidence.py::test_parse_structured_sections_sets_evidence_fields PASSED
6 passed
```

- [ ] **Step 7: Smoke test structured parser (no Ollama needed)**

With Python service running:
```bash
curl -s -X POST "http://localhost:8001/internal/graph/extract-evidence?use_llm=false&limit=10" | python3 -m json.tool
```

Expected:
```json
{
  "docs_processed": 10,
  "chunks_processed": 0,
  "edges_enriched": 3,
  "edges_created": 5,
  "llm_calls": 0,
  "errors": 0
}
```

- [ ] **Step 8: Smoke test with LLM (Ollama must be running)**

```bash
# In separate terminal: ollama serve
curl -s -X POST "http://localhost:8001/internal/graph/extract-evidence?use_llm=true&limit=5&service_filter=lambda" | python3 -m json.tool
```

Expected: `llm_calls` > 0, `edges_enriched` + `edges_created` > 0.

- [ ] **Step 9: Verify evidence in Neo4j**

```bash
export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock
docker exec $(docker ps -q --filter name=neo4j) cypher-shell -u neo4j -p devpassword \
  "MATCH ()-[r:CROSS_SERVICE]->() WHERE r.evidence_text IS NOT NULL RETURN r.rel_type, r.evidence_text, r.confidence, r.extraction_method LIMIT 5"
```

Expected: rows with `evidence_text` and `confidence` populated.

- [ ] **Step 10: Commit**

```bash
git add agent-service/app/graph/evidence.py agent-service/app/main.py agent-service/tests/unit/test_graph/test_evidence.py
git commit -m "feat(evidence): add hybrid extraction pipeline (structured parser + Ollama LLM)"
```

---

### Task 2: Java evidence API endpoint

**Files:**
- Modify: `api-service/src/main/java/com/awsdocs/application/port/out/GraphRepository.java` — add `getEvidence()`
- Modify: `api-service/src/main/java/com/awsdocs/adapter/out/graph/Neo4jGraphClient.java` — implement `getEvidence()`
- Modify: `api-service/src/main/java/com/awsdocs/adapter/in/rest/GalaxyController.java` — add `GET /v1/graph/evidence`
- Create: `api-service/src/test/java/com/awsdocs/adapter/in/rest/EvidenceControllerTest.java`

**Interfaces:**
- Consumes: Neo4j CROSS_SERVICE edges with `evidence_text`, `source_url`, `confidence`, `extraction_method` properties (from Task 1)
- Produces: `GET /v1/graph/evidence?src=lambda&tgt=dynamodb&rel=TRIGGERS` → `{"src", "tgt", "rel_type", "evidence": [...]}`

- [ ] **Step 1: Add `getEvidence()` to GraphRepository port**

In `api-service/src/main/java/com/awsdocs/application/port/out/GraphRepository.java`, add:
```java
List<Map<String, Object>> getEvidence(String src, String tgt, String relType);
```

- [ ] **Step 2: Write controller test**

Create `api-service/src/test/java/com/awsdocs/adapter/in/rest/EvidenceControllerTest.java`:
```java
package com.awsdocs.adapter.in.rest;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.awsdocs.application.port.out.GraphRepository;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(GalaxyController.class)
class EvidenceControllerTest {

  @Autowired MockMvc mockMvc;
  @MockBean GraphRepository graphRepository;

  @Test
  void get_evidence_returns_list() throws Exception {
    when(graphRepository.getEvidence("lambda", "dynamodb", "TRIGGERS"))
        .thenReturn(List.of(Map.of(
            "evidence_text", "DynamoDB Streams triggers Lambda when items change",
            "source_url", "https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html",
            "source_doc_title", "Using Lambda with DynamoDB",
            "confidence", 0.92,
            "extraction_method", "llm")));

    mockMvc.perform(get("/v1/graph/evidence")
            .param("src", "lambda")
            .param("tgt", "dynamodb")
            .param("rel", "TRIGGERS"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.src").value("lambda"))
        .andExpect(jsonPath("$.tgt").value("dynamodb"))
        .andExpect(jsonPath("$.rel_type").value("TRIGGERS"))
        .andExpect(jsonPath("$.evidence[0].evidence_text").value("DynamoDB Streams triggers Lambda when items change"))
        .andExpect(jsonPath("$.evidence[0].confidence").value(0.92));
  }

  @Test
  void get_evidence_returns_empty_when_no_match() throws Exception {
    when(graphRepository.getEvidence("lambda", "rds", "TRIGGERS"))
        .thenReturn(List.of());

    mockMvc.perform(get("/v1/graph/evidence")
            .param("src", "lambda")
            .param("tgt", "rds")
            .param("rel", "TRIGGERS"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.evidence").isEmpty());
  }
}
```

- [ ] **Step 3: Run test — verify FAIL**

```bash
cd api-service && DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn test -Dtest=EvidenceControllerTest 2>&1 | tail -5
```
Expected: COMPILATION ERROR — `getEvidence` not implemented.

- [ ] **Step 4: Implement Neo4j query**

In `Neo4jGraphClient.java`, add:
```java
@Override
public List<Map<String, Object>> getEvidence(String src, String tgt, String relType) {
  try (Session session = driver.session()) {
    return session.run("""
        MATCH (a:Document {service: $src})-[r:CROSS_SERVICE {rel_type: $relType}]->(b:Document {service: $tgt})
        WHERE r.evidence_text IS NOT NULL
        RETURN r.evidence_text AS evidence_text,
               r.source_url AS source_url,
               coalesce(r.source_doc_title, '') AS source_doc_title,
               r.confidence AS confidence,
               coalesce(r.extraction_method, 'rule_based') AS extraction_method
        ORDER BY r.confidence DESC
        LIMIT 5
        """, Map.of("src", src, "tgt", tgt, "relType", relType))
        .list(r -> Map.of(
            "evidence_text", r.get("evidence_text").asString(""),
            "source_url", r.get("source_url").asString(""),
            "source_doc_title", r.get("source_doc_title").asString(""),
            "confidence", r.get("confidence").asDouble(0.6),
            "extraction_method", r.get("extraction_method").asString("rule_based")));
  }
}
```

- [ ] **Step 5: Add endpoint to GalaxyController**

In `GalaxyController.java`, add:
```java
@GetMapping("/evidence")
public Map<String, Object> evidence(
    @RequestParam String src,
    @RequestParam String tgt,
    @RequestParam String rel) {
  return Map.of(
      "src", src,
      "tgt", tgt,
      "rel_type", rel,
      "evidence", graphRepository.getEvidence(src, tgt, rel));
}
```

- [ ] **Step 6: Run tests — verify PASS**

```bash
DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn test -Dtest=EvidenceControllerTest 2>&1 | grep -E "Tests run:|BUILD"
```
Expected: `BUILD SUCCESS`, 2 tests pass.

- [ ] **Step 7: Smoke test**

Restart Java service, then:
```bash
curl -s "http://localhost:8083/v1/graph/evidence?src=lambda&tgt=dynamodb&rel=TRIGGERS" | python3 -m json.tool
```
Expected: JSON with `evidence` array (may be empty if extraction not run yet).

- [ ] **Step 8: Commit**

```bash
git add api-service/src/
git commit -m "feat(evidence): add GET /v1/graph/evidence endpoint"
```

---

### Task 3: Frontend evidence panel

**Files:**
- Create: `web/components/EvidencePanel.tsx`
- Modify: `web/lib/api.ts` — add `fetchEvidence()`
- Modify: `web/lib/types.ts` — add `EvidenceItem`, `EvidenceResponse`
- Modify: `web/app/galaxy/page.tsx` — add `onLinkClick` handler, render `EvidencePanel`

**Interfaces:**
- Consumes: `GET /v1/graph/evidence?src=&tgt=&rel=` (from Task 2)
- Produces: `<EvidencePanel>` component, shown when user clicks edge in galaxy

- [ ] **Step 1: Add types**

In `web/lib/types.ts`, add:
```typescript
export interface EvidenceItem {
  evidence_text: string;
  source_url: string;
  source_doc_title: string;
  confidence: number;
  extraction_method: "llm" | "structured_parser" | "rule_based";
}

export interface EvidenceResponse {
  src: string;
  tgt: string;
  rel_type: string;
  evidence: EvidenceItem[];
}
```

- [ ] **Step 2: Add fetchEvidence to api.ts**

In `web/lib/api.ts`, add:
```typescript
export async function fetchEvidence(
  src: string,
  tgt: string,
  rel: string,
): Promise<EvidenceResponse> {
  return apiFetch<EvidenceResponse>(
    `/v1/graph/evidence?src=${encodeURIComponent(src)}&tgt=${encodeURIComponent(tgt)}&rel=${encodeURIComponent(rel)}`,
    undefined,
    true,
  );
}
```

- [ ] **Step 3: Create EvidencePanel component**

Create `web/components/EvidencePanel.tsx`:
```tsx
"use client";

import { useState, useEffect } from "react";
import { fetchEvidence } from "@/lib/api";
import type { EvidenceItem, EvidenceResponse } from "@/lib/types";

interface Props {
  src: string;
  tgt: string;
  relType: string;
  color: string;
  onClose: () => void;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.85 ? "#66bb6a" : value >= 0.7 ? "#ffd54f" : "#ef5350";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: "#333", borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color: "#aaa", minWidth: 32 }}>{pct}%</span>
    </div>
  );
}

export function EvidencePanel({ src, tgt, relType, color, onClose }: Props) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchEvidence(src, tgt, relType)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [src, tgt, relType]);

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        background: "#0d0d1a",
        borderLeft: `1px solid ${color}33`,
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        fontFamily: "sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${color}22` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
            Relationship
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 16 }}
          >
            ×
          </button>
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color, fontWeight: 700, fontSize: 13 }}>{src.toUpperCase()}</span>
          <span style={{ color: "#555", fontSize: 11 }}>──</span>
          <span
            style={{
              background: `${color}22`,
              border: `1px solid ${color}55`,
              color,
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 3,
              fontWeight: 600,
            }}
          >
            {relType}
          </span>
          <span style={{ color: "#555", fontSize: 11 }}>──►</span>
          <span style={{ color, fontWeight: 700, fontSize: 13 }}>{tgt.toUpperCase()}</span>
        </div>
      </div>

      {/* Evidence */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {loading && (
          <p style={{ color: "#666", fontSize: 13 }}>Loading evidence…</p>
        )}
        {!loading && (!data || data.evidence.length === 0) && (
          <div>
            <p style={{ color: "#666", fontSize: 13, fontStyle: "italic" }}>
              "Detected from document pattern"
            </p>
            <div style={{ marginTop: 12 }}>
              <div style={{ color: "#555", fontSize: 11, marginBottom: 4 }}>Confidence</div>
              <ConfidenceBar value={0.6} />
            </div>
            <div style={{ marginTop: 8, color: "#555", fontSize: 11 }}>
              Method: Rule-based
            </div>
          </div>
        )}
        {!loading && data && data.evidence.map((item: EvidenceItem, i: number) => (
          <div
            key={i}
            style={{
              marginBottom: 20,
              paddingBottom: 16,
              borderBottom: i < data.evidence.length - 1 ? "1px solid #1a1a2e" : "none",
            }}
          >
            <p
              style={{
                color: "#ddd",
                fontSize: 13,
                lineHeight: 1.6,
                fontStyle: "italic",
                margin: "0 0 12px",
                borderLeft: `3px solid ${color}88`,
                paddingLeft: 10,
              }}
            >
              "{item.evidence_text}"
            </p>
            <div style={{ color: "#888", fontSize: 11, marginBottom: 6 }}>Source</div>
            <div style={{ color: "#aaa", fontSize: 12, marginBottom: 4 }}>
              {item.source_doc_title || "AWS Documentation"}
            </div>
            <a
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#4fc3f7",
                fontSize: 11,
                textDecoration: "none",
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginBottom: 10,
              }}
            >
              🔗 {item.source_url.replace("https://", "")}
            </a>
            <div style={{ color: "#888", fontSize: 11, marginBottom: 4 }}>Confidence</div>
            <ConfidenceBar value={item.confidence} />
            <div style={{ marginTop: 6, color: "#555", fontSize: 10 }}>
              Method: {item.extraction_method === "llm" ? "LLM extraction" : item.extraction_method === "structured_parser" ? "Structured parser" : "Rule-based"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire evidence panel into galaxy page**

In `web/app/galaxy/page.tsx`, add state and handler at the top of component (after existing state):
```typescript
const [evidenceEdge, setEvidenceEdge] = useState<{
  src: string; tgt: string; relType: string; color: string;
} | null>(null);
```

Add `onLinkClick` to the `GalaxyScene` props passing:
```typescript
onLinkClick={(link) => {
  const l = link as { source: string; target: string; label: string };
  setEvidenceEdge({
    src: l.source,
    tgt: l.target,
    relType: l.label ?? "INTEGRATES_WITH",
    color: REL_COLORS[l.label] ?? "#4fc3f7",
  });
}}
```

In `GalaxyScene`, add `onLinkClick` prop to `<ForceGraph2D>`:
```typescript
onLinkClick={onLinkClick}
```

Render panel at bottom of return (inside the outer div):
```tsx
{evidenceEdge && (
  <EvidencePanel
    src={evidenceEdge.src}
    tgt={evidenceEdge.tgt}
    relType={evidenceEdge.relType}
    color={evidenceEdge.color}
    onClose={() => setEvidenceEdge(null)}
  />
)}
```

- [ ] **Step 5: Verify in browser**

1. Open http://localhost:3000/galaxy
2. Click any visible edge between planets
3. Evidence panel should slide in from the right
4. Shows relationship header, evidence text (or fallback), source URL, confidence bar

- [ ] **Step 6: Commit**

```bash
git add web/components/EvidencePanel.tsx web/lib/types.ts web/lib/api.ts web/app/galaxy/page.tsx
git commit -m "feat(evidence): add evidence panel on edge click in galaxy view"
```

---

## Validation checklist (from spec §9)

- [ ] `POST /internal/graph/extract-evidence?use_llm=false&limit=100` processes 100 docs and produces ≥ 50 enriched edges
- [ ] Verify in Neo4j: `MATCH ()-[r:CROSS_SERVICE]->() WHERE r.evidence_text IS NOT NULL RETURN count(r)` returns ≥ 50
- [ ] New edge types appear: `MATCH ()-[r:CROSS_SERVICE]->() RETURN DISTINCT r.rel_type` shows MONITORS, WRITES_TO, etc.
- [ ] `GET /v1/graph/evidence?src=lambda&tgt=dynamodb&rel=TRIGGERS` returns evidence with `source_url`
- [ ] Click galaxy edge → evidence panel opens with text + URL + confidence bar
- [ ] Click galaxy edge with no LLM evidence → fallback panel shown (rule-based, 0.60 confidence)
- [ ] Close button on panel works
