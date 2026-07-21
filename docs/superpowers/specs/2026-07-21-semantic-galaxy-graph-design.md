# Semantic Galaxy Graph — Design

**Status:** Approved, ready for implementation planning
**Date:** 2026-07-21
**Author:** Brainstorm session (user + Claude)
**Project:** aws-docs-graph

---

## 1. Goal

Transform the current flat force-directed graph into a **multi-level interactive knowledge galaxy** where users can drill down from the AWS universe → service clusters → individual services → concepts within each service. A **semantic gravity** feature lets users focus on any node and the graph self-organises by relevance.

---

## 2. Scope

This spec covers **Subsystem A: Semantic Galaxy Graph** — the visual foundation. Three other subsystems (B: Learning Mode, C: Semantic Gravity advanced, D: AI-highlighted subgraph) will be separate specs that depend on this one.

**In scope:**
- Multi-level drill-down (Universe → Cluster → Service → Concept)
- Auto-clustering via Louvain algorithm (Python networkx fallback, not Neo4j GDS)
- Heading-based concept extraction (H1/H2/H3)
- Semantic gravity (focus node → graph re-weights by relevance)
- In-place animation (same canvas, no page navigation between levels)

**Out of scope:**
- LLM-based concept extraction
- Learning mode (user progress tracking)
- Quiz integration
- Mobile layout

---

## 3. Data Model

### 3.1 New Neo4j properties on `:Document`

```cypher
// Added by run-clustering endpoint
d.community_id       String    -- Louvain community identifier (e.g. "community-42")
d.community_label    String    -- Human-readable label derived from dominant service in community

// Added by extract-concepts endpoint
d.extracted_concepts_at  DateTime  -- Timestamp of last concept extraction
```

### 3.2 New node type `:Concept`

```cypher
CREATE CONSTRAINT concept_id_unique IF NOT EXISTS
  FOR (c:Concept) REQUIRE c.id IS UNIQUE;

(:Concept {
  id           String    -- uuid
  name         String    -- heading text (H1/H2/H3)
  service      String    -- inherited from source document (e.g. "s3")
  source_doc_id String   -- Document.id this heading came from
  level        Int       -- heading level: 1, 2, or 3
  created_at   DateTime
})
```

### 3.3 New edge types

```cypher
(:Document)-[:CONTAINS_CONCEPT]->(:Concept)
(:Concept)-[:RELATED_TO {shared_doc_count: Int}]->(:Concept)
```

`RELATED_TO` edges connect concepts that co-appear in the same document. `shared_doc_count` increments on each re-extraction run.

### 3.4 New Postgres column

```sql
ALTER TABLE app.documents ADD COLUMN extracted_concepts_at timestamptz;
```

---

## 4. API

### 4.1 New Java endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/graph/clusters` | Level 1 — all communities with node count + centroid |
| `GET` | `/v1/graph/clusters/{communityId}/services` | Level 2 — services inside a community |
| `GET` | `/v1/graph/services/{service}/concepts` | Level 3 — concept nodes for a service |
| `GET` | `/v1/graph/focus/{nodeId}?limit=50` | Semantic gravity subgraph from a focal node |

**`GET /v1/graph/clusters` response:**
```json
{
  "clusters": [
    {
      "id": "community-42",
      "label": "Storage & Data",
      "nodeCount": 312,
      "centroidId": "uuid-of-most-connected-node",
      "services": ["s3", "dynamodb", "rds", "glacier"]
    }
  ]
}
```

**`GET /v1/graph/focus/{nodeId}?limit=50` response:**
```json
{
  "center": { "id": "...", "label": "S3", "service": "s3" },
  "nodes": [
    { "id": "...", "label": "IAM", "service": "iam", "gravityScore": 0.92, "distance": 1 },
    { "id": "...", "label": "KMS", "service": "kms", "gravityScore": 0.78, "distance": 2 }
  ],
  "edges": [
    { "source": "...", "target": "...", "weight": 0.92 }
  ]
}
```

Gravity score computation: BFS from focal node, score = `1 / (hop_distance * (1 + 1/edge_weight))`. Nodes with `gravityScore < 0.3` are excluded from response.

### 4.2 New Python endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/internal/graph/extract-concepts` | Parse H1/H2/H3 from crawled docs → insert `:Concept` nodes |
| `POST` | `/internal/graph/run-clustering` | Run Louvain via networkx, write `community_id` to Neo4j |

---

## 5. Concept Extraction Pipeline

### 5.1 `POST /internal/graph/extract-concepts`

1. Query Postgres: `SELECT id, url FROM app.documents WHERE extracted_concepts_at IS NULL AND status = 'active' LIMIT 500`
2. For each doc: re-fetch URL or use cached HTML (store in `app.mcp_cache` with tool_name='html_cache')
3. Parse with BeautifulSoup: extract all `h1`, `h2`, `h3` tags from `#main-content`
4. For each heading → Neo4j MERGE `:Concept` node
5. For each pair of concepts in same doc → MERGE `RELATED_TO` edge, increment `shared_doc_count`
6. Update `documents.extracted_concepts_at = now()`

**Runs after** each sitemap ingest (added to ingest pipeline as final step).

### 5.2 `POST /internal/graph/run-clustering`

Uses Python `python-louvain` (community detection library), not Neo4j GDS (unavailable on AuraDB Free).

```python
1. Load all Document nodes + LINKS_TO edges from Neo4j into networkx Graph
2. Run community.best_partition(G)  # Louvain
3. For each (node_id, community_id) in partition:
   - MERGE community label from dominant service in that community
   - SET d.community_id = community_id, d.community_label = label
4. Return {communities: N, nodes_assigned: M}
```

**Runs:** Weekly via existing EventBridge cron (Monday 02:00 UTC). Also callable manually.

---

## 6. Frontend — SemanticGalaxy Component

### 6.1 Replace GraphCanvas with SemanticGalaxy

New component `web/components/SemanticGalaxy.tsx` replaces `GraphCanvas.tsx`. Pages `/graph` and `/graph/[id]` updated to use it.

### 6.2 Drill-down state machine

```typescript
type GalaxyLevel =
  | { type: 'universe' }
  | { type: 'cluster'; clusterId: string }
  | { type: 'service'; service: string }
  | { type: 'concept'; nodeId: string };
```

History stack: `GalaxyLevel[]` — back button pops the stack.

### 6.3 Level transitions (animation)

Each transition:
1. Fetch next level data from API
2. Mark outgoing nodes: set `opacity = 0.1`, `size = 0.5` over 300ms
3. Insert incoming nodes at center position
4. Re-run D3 force simulation with new data
5. Animate to stable layout

Implemented via `react-force-graph-2d`'s `nodeVal` (for size) and `nodeColor` (for opacity blending).

### 6.4 Semantic Gravity

Activated by single-click on any node (double-click = drill-down).

```
onClick(node) →
  GET /v1/graph/focus/{node.id}?limit=50 →
  Re-render: center node largest, others sized/faded by gravityScore →
  D3 link strength = gravityScore →
  Nodes with gravityScore < 0.3 → opacity 0.05
```

Deactivated by clicking background or pressing Escape.

### 6.5 File structure

```
web/components/
├── SemanticGalaxy.tsx          main orchestrator
├── galaxy/
│   ├── useGalaxyState.ts       state machine hook
│   ├── useGalaxyData.ts        API fetch hooks per level
│   ├── galaxyForceConfig.ts    D3 force parameters per level
│   └── gravityUtils.ts         score → visual property mapping
```

---

## 7. Validation criteria ("done")

1. `/graph` renders Level 0 view: nodes grouped visually by community, colour-coded
2. Click a community → Level 1 view animates in-place, showing services in that community
3. Click a service → Level 2 view shows concept nodes (H2/H3 headings)
4. Back button at each level restores previous view with animation
5. Single-click any node → semantic gravity activates, graph re-weights
6. Escape / click background → gravity deactivates, graph restores
7. `POST /internal/graph/run-clustering` assigns `community_id` to ≥90% of non-placeholder Document nodes
8. `POST /internal/graph/extract-concepts` creates `:Concept` nodes for ≥80% of crawled docs

---

## 8. Dependencies

- `python-louvain` (pip) — community detection
- `networkx` (pip) — graph data structure for Louvain
- React force-graph-2d — already installed
- Neo4j GDS — **NOT required** (using networkx fallback)
- Neo4j APOC — not required

---

## 9. Phase 2 extensions (out of scope)

- Replace networkx Louvain with Neo4j GDS when available (AuraDB Enterprise)
- LLM concept extraction for richer semantic edges
- Learning Mode overlay on galaxy view
- Semantic Gravity advanced (cosine similarity from embeddings)
