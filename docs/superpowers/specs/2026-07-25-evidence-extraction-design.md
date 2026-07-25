# Evidence-first Extraction Pipeline — Design

**Status:** Approved, ready for implementation planning
**Date:** 2026-07-25
**Author:** Brainstorm session (user + Claude)
**Project:** aws-docs-graph

---

## 1. Goal

Build a hybrid extraction pipeline that enriches the knowledge graph with **evidence-backed relationships** — every edge between AWS services carries the source doc URL, the exact text chunk it was derived from, and a confidence score. Users can click any edge and see *why* the relationship exists.

---

## 2. Scope

**In scope:**
- Structured parser: extract relationships from HTML section headers (## Triggers, ## Monitoring, etc.) — free, fast
- LLM batch extractor: extract relationships from prose chunks using local Ollama llama3.1:8b — one-time cost ~$0
- Enrich existing CROSS_SERVICE edges with evidence properties
- New edges from LLM extraction merged into Neo4j
- Java API endpoint: `GET /v1/graph/evidence`
- Frontend evidence panel: shown on edge click in galaxy view

**Out of scope:**
- Real-time LLM extraction during user queries
- External LLM APIs (Anthropic, OpenAI, Gemini)
- Re-ingesting all docs (uses already-crawled HTML)
- Learning mode, AI mode (separate features)

---

## 3. Architecture

```
Existing Rule-based (Phase 1)
  Doc title → regex → CROSS_SERVICE {rel_type, weight}

New LLM Batch (Phase 2)
  POST /internal/graph/extract-evidence
    ├── Load docs from Postgres (batches of 50)
    ├── Chunk HTML content (500 tokens, 50 overlap)
    ├── Call Ollama HTTP API (localhost:11434)
    │     Model: llama3.1:8b
    │     Output: [{src_service, rel_type, tgt_service, evidence_text, confidence}]
    ├── Structured parser (free, runs first)
    │     Parse ## Triggers, ## Monitoring, ## Security sections
    │     → relationships with confidence=0.85, method='structured_parser'
    ├── Match/Enrich existing CROSS_SERVICE edges in Neo4j
    │     IF match: SET evidence_text, source_url, confidence, extraction_method='llm'
    │     IF new:   MERGE edge with full properties
    └── Track progress: app.crawl_log (outcome='evidence_extracted')
```

---

## 4. Data Model

### 4.1 Enriched CROSS_SERVICE edge properties

```cypher
(:Document)-[:CROSS_SERVICE {
  // existing
  rel_type:           String,   // "TRIGGERS" | "INTEGRATES_WITH" | "USES" | etc.
  weight:             Int,
  created_at:         DateTime,
  // new
  evidence_text:      String,   // exact sentence/heading from source doc
  source_url:         String,   // URL of the doc that generated this edge
  source_doc_title:   String,   // human-readable doc title
  confidence:         Float,    // 0.0–1.0
  extraction_method:  String    // "llm" | "structured_parser" | "rule_based"
}]->(:Document)
```

### 4.2 New relationship types from LLM

In addition to existing 6 types, LLM may produce:
- `MONITORS` — CloudWatch monitors Lambda
- `DEPLOYS_VIA` — ECS deploys via CloudFormation
- `AUTHENTICATES_WITH` — service authenticates with Cognito
- `ENCRYPTS_WITH` — S3 encrypted by KMS
- `READS_FROM` — Lambda reads from DynamoDB
- `WRITES_TO` — Lambda writes to S3

All stored as `CROSS_SERVICE` with `rel_type` property.

---

## 5. LLM Extraction

### 5.1 Chunking strategy

- Source: HTML already crawled (re-fetch if needed from URL)
- Parse with BeautifulSoup: extract `#main-content` text
- Chunk: 500 tokens, 50-token overlap
- Skip chunks < 100 tokens (navigation, footers)

### 5.2 Prompt

```
You are extracting AWS service relationships from documentation.

Given this text from an AWS doc about {service}:
---
{chunk_text}
---

Extract relationships as JSON. Only extract clear, factual relationships.
Return [] if none found.

Output format:
[
  {
    "src": "lambda",
    "rel_type": "TRIGGERS",
    "tgt": "dynamodb",
    "evidence": "exact sentence from text that shows this relationship",
    "confidence": 0.0-1.0
  }
]

Rules:
- src and tgt must be AWS service names (lowercase, no spaces)
- rel_type must be one of: TRIGGERS, INTEGRATES_WITH, USES, MONITORS, DEPLOYS_VIA, AUTHENTICATES_WITH, ENCRYPTS_WITH, READS_FROM, WRITES_TO, STORES_IN
- evidence must be a direct quote from the text
- confidence: 0.9+ for explicit statements, 0.7-0.9 for implied, <0.7 skip
- Return [] if no clear relationships found
```

### 5.3 Ollama HTTP API call

```python
POST http://localhost:11434/api/generate
{
  "model": "llama3.1:8b",
  "prompt": "...",
  "format": "json",
  "stream": false,
  "options": {"temperature": 0.1}  # low temp for extraction
}
```

### 5.4 Structured parser (runs before LLM)

Parse sections like:
```html
<h2>Event sources</h2>
<ul>
  <li>Amazon S3</li>
  <li>Amazon DynamoDB</li>
  <li>Amazon SQS</li>
</ul>
```
→ `lambda -[TRIGGERED_BY]-> s3` (confidence=0.85, method=structured_parser)

Section patterns:
| Section header | rel_type |
|---|---|
| Triggers / Event sources | TRIGGERED_BY |
| Monitoring / Metrics | MONITORED_BY |
| Security / IAM | AUTHENTICATES_WITH |
| Storage / Data stores | STORES_IN |
| Integrations / Works with | INTEGRATES_WITH |

---

## 6. API

### 6.1 New Python endpoint

```
POST /internal/graph/extract-evidence
  Query params:
    limit: int = 100          # docs per run
    use_llm: bool = true      # whether to call Ollama
    service_filter: str = ""  # optional: only process docs for this service

Response:
{
  "docs_processed": 100,
  "chunks_processed": 1240,
  "edges_enriched": 312,
  "edges_created": 89,
  "llm_calls": 248,
  "errors": 3
}
```

### 6.2 New Java endpoint

```
GET /v1/graph/evidence?src={service}&tgt={service}&rel={rel_type}

Response:
{
  "src": "lambda",
  "tgt": "dynamodb",
  "rel_type": "TRIGGERS",
  "evidence": [
    {
      "evidence_text": "DynamoDB Streams triggers Lambda when items change",
      "source_url": "https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html",
      "source_doc_title": "Using Lambda with DynamoDB",
      "confidence": 0.92,
      "extraction_method": "llm"
    }
  ]
}
```

---

## 7. Frontend — Evidence Panel

**Trigger:** Click any link/edge in the 3D galaxy (Level 0 or Level 1).

**Component:** `EvidencePanel.tsx` — slides in from right side.

```
┌─────────────────────────────────────┐
│ Relationship                    [×] │
│                                     │
│  Lambda  ──[TRIGGERS]──►  DynamoDB  │
│                                     │
├─────────────────────────────────────┤
│ Evidence                            │
│                                     │
│ "DynamoDB Streams triggers Lambda   │
│  functions when table items change" │
│                                     │
│ Source                              │
│ Using Lambda with DynamoDB          │
│ 🔗 docs.aws.amazon.com/lambda/...   │
│                                     │
│ Confidence  ████████░░  0.92        │
│ Method      LLM                     │
└─────────────────────────────────────┘
```

**Fallback** (no LLM evidence yet):
```
Evidence: "Detected from doc title pattern"
Confidence: 0.60
Method: Rule-based
```

---

## 8. Setup requirements

1. **Install Ollama:** `brew install ollama`
2. **Pull model:** `ollama pull llama3.1:8b`
3. **Start Ollama server:** `ollama serve` (runs on localhost:11434)
4. **Run extraction:** `POST /internal/graph/extract-evidence`

Ollama server must be running when extraction job is triggered. Not required for normal app operation.

---

## 9. Validation criteria

1. `POST /internal/graph/extract-evidence` processes 100 docs, produces ≥50 enriched edges
2. ≥50% of existing CROSS_SERVICE edges gain `evidence_text` property
3. New edge types (MONITORS, WRITES_TO, READS_FROM) appear in Neo4j
4. `GET /v1/graph/evidence?src=lambda&tgt=dynamodb&rel=TRIGGERS` returns evidence with source URL
5. Galaxy Level 0 edge click opens evidence panel with text + URL
6. Fallback panel shown for edges without LLM evidence
