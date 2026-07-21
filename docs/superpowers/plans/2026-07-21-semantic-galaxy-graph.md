# Semantic Galaxy Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the flat graph into a multi-level interactive knowledge galaxy with auto-clustering, drill-down animation, and semantic gravity.

**Architecture:** Python runs Louvain clustering (networkx) and concept extraction (BeautifulSoup headings), writing results back to Neo4j. Java serves new level-aware graph endpoints. The frontend replaces GraphCanvas with SemanticGalaxy — a state-machine-driven component that animates level transitions in-place using react-force-graph-2d.

**Tech Stack:** Python 3.12 + networkx + python-louvain | Java 21 + Spring Boot 3 + neo4j-java-driver | Next.js 15 + react-force-graph-2d + TanStack Query

## Global Constraints

- Neo4j: AuraDB Free — GDS plugin NOT available, use networkx Louvain instead
- Python service: existing FastAPI app at `agent-service/`, venv at `agent-service/.venv/`
- Java service: existing Spring Boot 3 app at `api-service/`, running on port 8083 locally
- All Neo4j writes use `MERGE` (idempotent)
- All new Postgres columns: non-breaking `ALTER TABLE ... ADD COLUMN ... DEFAULT NULL`
- Frontend: `web/`, Next.js 15 App Router, TanStack Query v5
- Colors: service color palette already defined in `web/components/GraphCanvas.tsx` as `SERVICE_PALETTE`

---

## File Structure

```
agent-service/app/
├── graph/
│   ├── co_returned.py          (existing)
│   ├── clustering.py           NEW — Louvain via networkx
│   └── concepts.py             NEW — H1/H2/H3 extraction
├── main.py                     MODIFY — register new routers
tests/unit/
└── test_graph/
    ├── test_clustering.py      NEW
    └── test_concepts.py        NEW

api-service/src/main/java/com/awsdocs/
├── adapter/
│   ├── in/rest/
│   │   └── GalaxyController.java    NEW — /v1/graph/clusters, /v1/graph/focus
│   └── out/graph/
│       └── Neo4jGraphClient.java    MODIFY — add cluster/concept/focus queries
├── application/port/out/
│   └── GraphRepository.java         MODIFY — add 4 new method signatures
└── domain/model/
    └── GalaxyNode.java              NEW — shared response type

web/
├── components/
│   ├── SemanticGalaxy.tsx           NEW — replaces GraphCanvas as main graph component
│   └── galaxy/
│       ├── useGalaxyState.ts        NEW — state machine
│       ├── useGalaxyData.ts         NEW — API hooks per level
│       ├── galaxyForceConfig.ts     NEW — D3 force params per level
│       └── gravityUtils.ts          NEW — gravityScore → visual mapping
├── app/graph/page.tsx               MODIFY — use SemanticGalaxy
└── app/graph/[id]/page.tsx          MODIFY — use SemanticGalaxy
```

---

### Task 1: Postgres migration + Neo4j constraints

**Files:**
- Create: `infra/migrations/postgres/V7__galaxy.sql`
- Create: `infra/migrations/neo4j/V2__galaxy_constraints.cypher`

**Interfaces:**
- Produces: `app.documents.extracted_concepts_at` column; Neo4j `Concept` node constraint

- [ ] **Step 1: Create Postgres migration**

Create `infra/migrations/postgres/V7__galaxy.sql`:
```sql
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS extracted_concepts_at timestamptz;
```

- [ ] **Step 2: Run migration locally**

```bash
export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock
make migrate-postgres
```

Expected output:
```
Migrating schema "app" to version "7 - galaxy"
Successfully applied 1 migration to schema "app", now at version v7
```

- [ ] **Step 3: Create Neo4j constraints**

Create `infra/migrations/neo4j/V2__galaxy_constraints.cypher`:
```cypher
CREATE CONSTRAINT concept_id_unique IF NOT EXISTS
  FOR (c:Concept) REQUIRE c.id IS UNIQUE;

CREATE INDEX concept_service_idx IF NOT EXISTS
  FOR (c:Concept) ON (c.service);

CREATE INDEX document_community_idx IF NOT EXISTS
  FOR (d:Document) ON (d.community_id);
```

- [ ] **Step 4: Apply Neo4j constraints**

```bash
export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock
./scripts/neo4j-migrate.sh
```

Expected:
```
Applying Neo4j migrations from .../infra/migrations/neo4j...
  → V2__galaxy_constraints.cypher
Neo4j migrations done.
```

- [ ] **Step 5: Verify**

```bash
export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock
docker exec $(docker ps -q --filter name=neo4j) cypher-shell -u neo4j -p devpassword "SHOW CONSTRAINTS" 2>&1 | grep concept
```

Expected: `concept_id_unique` listed.

- [ ] **Step 6: Commit**

```bash
git add infra/migrations/
git commit -m "feat(galaxy): add V7 Postgres migration and Neo4j Concept constraints"
```

---

### Task 2: Python clustering endpoint (networkx Louvain)

**Files:**
- Create: `agent-service/app/graph/clustering.py`
- Create: `agent-service/tests/unit/test_graph/test_clustering.py`
- Modify: `agent-service/app/main.py` — add `from app.graph.clustering import router as clustering_router` and `app.include_router(clustering_router)`

**Interfaces:**
- Consumes: Neo4j session from `app.db.neo4j.session`
- Produces: `POST /internal/graph/run-clustering` → `{"communities": int, "nodes_assigned": int}`

- [ ] **Step 1: Install dependencies**

```bash
cd agent-service && source .venv/bin/activate
pip install networkx python-louvain
echo "networkx==3.3" >> requirements.txt
echo "python-louvain==0.16" >> requirements.txt
```

- [ ] **Step 2: Write failing unit test**

Create `agent-service/tests/unit/test_graph/__init__.py` (empty).

Create `agent-service/tests/unit/test_graph/test_clustering.py`:
```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.graph.clustering import compute_communities, community_label


def test_compute_communities_assigns_all_nodes():
    # 4 nodes: 2 clusters (0-1 connected, 2-3 connected)
    nodes = ["a", "b", "c", "d"]
    edges = [("a", "b"), ("b", "a"), ("c", "d"), ("d", "c")]
    result = compute_communities(nodes, edges)
    assert set(result.keys()) == {"a", "b", "c", "d"}
    # nodes a,b should share a community; c,d should share a community
    assert result["a"] == result["b"]
    assert result["c"] == result["d"]
    assert result["a"] != result["c"]


def test_compute_communities_single_node():
    result = compute_communities(["x"], [])
    assert result == {"x": 0}


def test_community_label_uses_dominant_service():
    # community 5 has nodes with services: s3, s3, lambda
    node_services = {"n1": "s3", "n2": "s3", "n3": "lambda"}
    partition = {"n1": 5, "n2": 5, "n3": 5}
    label = community_label(5, partition, node_services)
    assert label == "s3"


def test_community_label_empty_community():
    label = community_label(99, {}, {})
    assert label == "community-99"
```

- [ ] **Step 3: Run test — verify FAIL**

```bash
cd agent-service && source .venv/bin/activate
pytest tests/unit/test_graph/test_clustering.py -v
```

Expected: `ERROR` — `app.graph.clustering` not found.

- [ ] **Step 4: Implement clustering.py**

Create `agent-service/app/graph/clustering.py`:
```python
import uuid
from collections import Counter
from datetime import UTC, datetime

import community as community_louvain
import networkx as nx
from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session

router = APIRouter()


def compute_communities(
    nodes: list[str], edges: list[tuple[str, str]]
) -> dict[str, int]:
    """Run Louvain on a node/edge list. Returns {node_id: community_id}."""
    G = nx.Graph()
    G.add_nodes_from(nodes)
    G.add_edges_from(edges)
    if len(G.nodes) == 0:
        return {}
    if len(G.edges) == 0:
        return {n: i for i, n in enumerate(nodes)}
    return community_louvain.best_partition(G)


def community_label(
    community_id: int,
    partition: dict[str, int],
    node_services: dict[str, str],
) -> str:
    """Derive a human-readable label from the dominant service in a community."""
    services = [
        node_services.get(n, "")
        for n, cid in partition.items()
        if cid == community_id and node_services.get(n)
    ]
    if not services:
        return f"community-{community_id}"
    dominant = Counter(services).most_common(1)[0][0]
    return dominant


@router.post("/internal/graph/run-clustering", status_code=202)
async def run_clustering():
    """Load Document graph into networkx, run Louvain, write community_id back to Neo4j."""
    async with neo4j_session() as s:
        # Load all real (non-placeholder) Document nodes
        result = await s.run(
            "MATCH (d:Document) WHERE d.placeholder IS NULL OR d.placeholder = false "
            "RETURN d.id AS id, d.service AS service"
        )
        records = await result.data()

    nodes = [r["id"] for r in records if r["id"]]
    node_services = {r["id"]: (r["service"] or "") for r in records if r["id"]}

    async with neo4j_session() as s:
        # Load LINKS_TO edges between real nodes
        result = await s.run(
            "MATCH (a:Document)-[:LINKS_TO]->(b:Document) "
            "WHERE a.placeholder IS NULL AND b.placeholder IS NULL "
            "AND a.id IS NOT NULL AND b.id IS NOT NULL "
            "RETURN a.id AS src, b.id AS tgt"
        )
        edge_records = await result.data()

    edges = [(r["src"], r["tgt"]) for r in edge_records]
    partition = compute_communities(nodes, edges)

    # Write community_id back to Neo4j in batches of 500
    batch_size = 500
    items = list(partition.items())
    async with neo4j_session() as s:
        for i in range(0, len(items), batch_size):
            batch = items[i : i + batch_size]
            assignments = [
                {
                    "id": node_id,
                    "community_id": f"community-{cid}",
                    "community_label": community_label(cid, partition, node_services),
                }
                for node_id, cid in batch
            ]
            await s.run(
                "UNWIND $rows AS row "
                "MATCH (d:Document {id: row.id}) "
                "SET d.community_id = row.community_id, "
                "    d.community_label = row.community_label",
                rows=assignments,
            )

    return {"communities": len(set(partition.values())), "nodes_assigned": len(partition)}
```

- [ ] **Step 5: Run tests — verify PASS**

```bash
pytest tests/unit/test_graph/test_clustering.py -v
```

Expected:
```
test_clustering.py::test_compute_communities_assigns_all_nodes PASSED
test_clustering.py::test_compute_communities_single_node PASSED
test_clustering.py::test_community_label_uses_dominant_service PASSED
test_clustering.py::test_community_label_empty_community PASSED
4 passed
```

- [ ] **Step 6: Register router in main.py**

In `agent-service/app/main.py`, add:
```python
from app.graph.clustering import router as clustering_router
# in app setup:
app.include_router(clustering_router)
```

- [ ] **Step 7: Smoke test**

With Python service running (`uvicorn app.main:app --port 8001 --reload`):
```bash
curl -s -X POST http://localhost:8001/internal/graph/run-clustering | python3 -m json.tool
```

Expected (values will vary):
```json
{"communities": 12, "nodes_assigned": 1850}
```

- [ ] **Step 8: Commit**

```bash
cd agent-service && git add app/graph/clustering.py tests/unit/test_graph/ requirements.txt app/main.py
git commit -m "feat(galaxy): add Louvain clustering endpoint (networkx)"
```

---

### Task 3: Python concept extraction endpoint

**Files:**
- Create: `agent-service/app/graph/concepts.py`
- Create: `agent-service/tests/unit/test_graph/test_concepts.py`
- Modify: `agent-service/app/main.py` — add concepts router

**Interfaces:**
- Consumes: `app.db.postgres.get_pool`, `app.db.neo4j.session`
- Produces: `POST /internal/graph/extract-concepts` → `{"docs_processed": int, "concepts_created": int}`

- [ ] **Step 1: Write failing unit tests**

Create `agent-service/tests/unit/test_graph/test_concepts.py`:
```python
from app.graph.concepts import extract_headings, build_concept_nodes


SAMPLE_HTML = """
<html><body>
<div id="main-content">
  <h1>Amazon S3 Overview</h1>
  <h2>Buckets</h2>
  <h3>Bucket Naming Rules</h3>
  <h2>Objects</h2>
  <h3>Object Keys</h3>
  <p>Some content here.</p>
</div>
</body></html>
"""


def test_extract_headings_returns_all_levels():
    headings = extract_headings(SAMPLE_HTML)
    assert len(headings) == 5
    assert headings[0] == ("Amazon S3 Overview", 1)
    assert headings[1] == ("Buckets", 2)
    assert headings[2] == ("Bucket Naming Rules", 3)


def test_extract_headings_ignores_empty():
    html = '<div id="main-content"><h2></h2><h2>Real Heading</h2></div>'
    headings = extract_headings(html)
    assert len(headings) == 1
    assert headings[0] == ("Real Heading", 2)


def test_extract_headings_no_main_content_falls_back_to_body():
    html = "<html><body><h1>Title</h1></body></html>"
    headings = extract_headings(html)
    assert headings[0] == ("Title", 1)


def test_build_concept_nodes_produces_unique_ids():
    doc_id = "doc-123"
    service = "s3"
    headings = [("Buckets", 2), ("Objects", 2), ("Buckets", 2)]
    nodes = build_concept_nodes(doc_id, service, headings)
    # Duplicate headings should be deduplicated
    names = [n["name"] for n in nodes]
    assert names.count("Buckets") == 1
    assert len(nodes) == 2
    # Each node has required fields
    for node in nodes:
        assert "id" in node
        assert "name" in node
        assert node["service"] == "s3"
        assert node["source_doc_id"] == "doc-123"
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
pytest tests/unit/test_graph/test_concepts.py -v
```

Expected: `ERROR` — module not found.

- [ ] **Step 3: Implement concepts.py**

Create `agent-service/app/graph/concepts.py`:
```python
import hashlib
import uuid
from datetime import UTC, datetime

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session
from app.db.postgres import get_pool

router = APIRouter()

BATCH_LIMIT = 200


def extract_headings(html: str) -> list[tuple[str, int]]:
    """Extract (text, level) tuples from H1/H2/H3 tags in main content."""
    soup = BeautifulSoup(html, "lxml")
    main = soup.find(id="main-content") or soup.body or soup
    headings = []
    seen = set()
    for tag in main.find_all(["h1", "h2", "h3"]):
        text = tag.get_text(strip=True)
        level = int(tag.name[1])
        if text and text not in seen:
            seen.add(text)
            headings.append((text, level))
    return headings


def build_concept_nodes(
    doc_id: str, service: str, headings: list[tuple[str, int]]
) -> list[dict]:
    """Build concept node dicts from heading tuples."""
    seen = set()
    nodes = []
    for name, level in headings:
        if name in seen:
            continue
        seen.add(name)
        # Deterministic ID: hash of doc_id + name so re-runs are idempotent
        concept_id = str(
            uuid.UUID(hashlib.md5(f"{doc_id}:{name}".encode()).hexdigest())
        )
        nodes.append(
            {
                "id": concept_id,
                "name": name,
                "service": service,
                "source_doc_id": doc_id,
                "level": level,
            }
        )
    return nodes


@router.post("/internal/graph/extract-concepts", status_code=202)
async def extract_concepts():
    """Parse H1/H2/H3 from un-processed docs and create :Concept nodes in Neo4j."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, url, service FROM app.documents "
        "WHERE extracted_concepts_at IS NULL AND status = 'active' "
        "LIMIT $1",
        BATCH_LIMIT,
    )

    docs_processed = 0
    concepts_created = 0

    async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
        for row in rows:
            try:
                resp = await client.get(
                    row["url"], headers={"User-Agent": "aws-docs-graph/1.0"}
                )
                resp.raise_for_status()
                headings = extract_headings(resp.text)
                concept_nodes = build_concept_nodes(
                    row["id"], row["service"] or "", headings
                )

                if concept_nodes:
                    async with neo4j_session() as s:
                        # MERGE concept nodes
                        await s.run(
                            "UNWIND $nodes AS n "
                            "MERGE (c:Concept {id: n.id}) "
                            "SET c.name = n.name, c.service = n.service, "
                            "    c.source_doc_id = n.source_doc_id, "
                            "    c.level = n.level "
                            "WITH c, n "
                            "MATCH (d:Document {id: n.source_doc_id}) "
                            "MERGE (d)-[:CONTAINS_CONCEPT]->(c)",
                            nodes=concept_nodes,
                        )
                        concepts_created += len(concept_nodes)

                # Mark doc as processed
                await pool.execute(
                    "UPDATE app.documents SET extracted_concepts_at = $1 WHERE id = $2",
                    datetime.now(UTC),
                    row["id"],
                )
                docs_processed += 1
            except Exception:
                pass  # skip failed docs, they will retry next run

    return {"docs_processed": docs_processed, "concepts_created": concepts_created}
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
pytest tests/unit/test_graph/test_concepts.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Register router in main.py**

```python
from app.graph.concepts import router as concepts_router
app.include_router(concepts_router)
```

- [ ] **Step 6: Smoke test**

```bash
curl -s -X POST http://localhost:8001/internal/graph/extract-concepts | python3 -m json.tool
```

Expected:
```json
{"docs_processed": 200, "concepts_created": 1200}
```

- [ ] **Step 7: Commit**

```bash
git add agent-service/app/graph/concepts.py agent-service/tests/unit/test_graph/test_concepts.py agent-service/app/main.py
git commit -m "feat(galaxy): add concept extraction endpoint (H1/H2/H3 → :Concept nodes)"
```

---

### Task 4: Java GalaxyController + new GraphRepository methods

**Files:**
- Create: `api-service/src/main/java/com/awsdocs/domain/model/GalaxyNode.java`
- Create: `api-service/src/main/java/com/awsdocs/adapter/in/rest/GalaxyController.java`
- Modify: `api-service/src/main/java/com/awsdocs/application/port/out/GraphRepository.java` — add 4 methods
- Modify: `api-service/src/main/java/com/awsdocs/adapter/out/graph/Neo4jGraphClient.java` — implement 4 methods
- Create: `api-service/src/test/java/com/awsdocs/adapter/in/rest/GalaxyControllerTest.java`

**Interfaces:**
- Consumes: existing `Driver driver` bean from Spring config
- Produces:
  - `GET /v1/graph/clusters` → `{"clusters": [{"id", "label", "nodeCount", "services", "centroidId"}]}`
  - `GET /v1/graph/clusters/{communityId}/services` → `{"services": [{"service", "nodeCount", "centroidId"}]}`
  - `GET /v1/graph/services/{service}/concepts` → `{"concepts": [{"id", "name", "level", "sourceDocId"}]}`
  - `GET /v1/graph/focus/{nodeId}?limit=50` → `{"center": {...}, "nodes": [...], "edges": [...]}`

- [ ] **Step 1: Create GalaxyNode domain model**

Create `api-service/src/main/java/com/awsdocs/domain/model/GalaxyNode.java`:
```java
package com.awsdocs.domain.model;

public record GalaxyNode(
    String id,
    String label,
    String service,
    String type,        // "document" | "concept" | "cluster"
    double gravityScore // 0.0–1.0, 1.0 = focal node
) {}
```

- [ ] **Step 2: Add methods to GraphRepository port**

In `api-service/src/main/java/com/awsdocs/application/port/out/GraphRepository.java`, add:
```java
import java.util.List;
import java.util.Map;

List<Map<String, Object>> getClusters();
List<Map<String, Object>> getServicesInCluster(String communityId);
List<Map<String, Object>> getConceptsForService(String service);
Map<String, Object> getFocusSubgraph(String nodeId, int limit);
```

- [ ] **Step 3: Write controller test**

Create `api-service/src/test/java/com/awsdocs/adapter/in/rest/GalaxyControllerTest.java`:
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
class GalaxyControllerTest {

  @Autowired MockMvc mockMvc;
  @MockBean GraphRepository graphRepository;

  @Test
  void get_clusters_returns_list() throws Exception {
    when(graphRepository.getClusters())
        .thenReturn(List.of(Map.of(
            "id", "community-1",
            "label", "s3",
            "nodeCount", 312,
            "services", List.of("s3", "glacier"),
            "centroidId", "uuid-abc")));

    mockMvc.perform(get("/v1/graph/clusters"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.clusters[0].id").value("community-1"))
        .andExpect(jsonPath("$.clusters[0].nodeCount").value(312));
  }

  @Test
  void get_focus_returns_center_and_nodes() throws Exception {
    when(graphRepository.getFocusSubgraph("node-1", 50))
        .thenReturn(Map.of(
            "center", Map.of("id", "node-1", "label", "S3", "service", "s3"),
            "nodes", List.of(Map.of("id", "node-2", "label", "IAM", "gravityScore", 0.85)),
            "edges", List.of()));

    mockMvc.perform(get("/v1/graph/focus/node-1?limit=50"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.center.id").value("node-1"))
        .andExpect(jsonPath("$.nodes[0].gravityScore").value(0.85));
  }
}
```

- [ ] **Step 4: Run test — verify FAIL**

```bash
cd api-service && DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn test -Dtest=GalaxyControllerTest 2>&1 | tail -5
```

Expected: COMPILATION ERROR — GalaxyController not found.

- [ ] **Step 5: Implement GalaxyController**

Create `api-service/src/main/java/com/awsdocs/adapter/in/rest/GalaxyController.java`:
```java
package com.awsdocs.adapter.in.rest;

import com.awsdocs.application.port.out.GraphRepository;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;
import java.util.Map;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/graph")
@Validated
public class GalaxyController {

  private final GraphRepository graphRepository;

  public GalaxyController(GraphRepository graphRepository) {
    this.graphRepository = graphRepository;
  }

  @GetMapping("/clusters")
  @Cacheable(value = "graph-overview", key = "'clusters'")
  public Map<String, Object> clusters() {
    return Map.of("clusters", graphRepository.getClusters());
  }

  @GetMapping("/clusters/{communityId}/services")
  public Map<String, Object> servicesInCluster(@PathVariable String communityId) {
    return Map.of("services", graphRepository.getServicesInCluster(communityId));
  }

  @GetMapping("/services/{service}/concepts")
  public Map<String, Object> conceptsForService(@PathVariable String service) {
    return Map.of("concepts", graphRepository.getConceptsForService(service));
  }

  @GetMapping("/focus/{nodeId}")
  public ResponseEntity<Map<String, Object>> focus(
      @PathVariable String nodeId,
      @RequestParam(defaultValue = "50") @Min(1) @Max(200) int limit) {
    var result = graphRepository.getFocusSubgraph(nodeId, limit);
    if (result.isEmpty()) return ResponseEntity.notFound().build();
    return ResponseEntity.ok(result);
  }
}
```

- [ ] **Step 6: Implement Neo4j queries in Neo4jGraphClient**

In `api-service/src/main/java/com/awsdocs/adapter/out/graph/Neo4jGraphClient.java`, add:

```java
@Override
public List<Map<String, Object>> getClusters() {
  try (Session session = driver.session()) {
    return session.run("""
        MATCH (d:Document)
        WHERE d.community_id IS NOT NULL
        WITH d.community_id AS cid, d.community_label AS label,
             count(d) AS nodeCount,
             collect(DISTINCT d.service)[0..6] AS services
        ORDER BY nodeCount DESC
        RETURN cid AS id, label, nodeCount, services,
               head([(d2:Document {community_id: cid})-[]-() | d2.id]) AS centroidId
        LIMIT 30
        """)
        .list(r -> Map.of(
            "id", r.get("id").asString(""),
            "label", r.get("label").asString(""),
            "nodeCount", r.get("nodeCount").asInt(0),
            "services", r.get("services").asList(),
            "centroidId", r.get("centroidId").asString("")));
  }
}

@Override
public List<Map<String, Object>> getServicesInCluster(String communityId) {
  try (Session session = driver.session()) {
    return session.run("""
        MATCH (d:Document {community_id: $cid})
        WHERE d.service IS NOT NULL AND d.service <> ''
        WITH d.service AS service, count(d) AS nodeCount
        ORDER BY nodeCount DESC
        RETURN service, nodeCount
        """, Map.of("cid", communityId))
        .list(r -> Map.of(
            "service", r.get("service").asString(""),
            "nodeCount", r.get("nodeCount").asInt(0)));
  }
}

@Override
public List<Map<String, Object>> getConceptsForService(String service) {
  try (Session session = driver.session()) {
    return session.run("""
        MATCH (c:Concept {service: $service})
        RETURN c.id AS id, c.name AS name, c.level AS level,
               c.source_doc_id AS sourceDocId
        ORDER BY c.level ASC, c.name ASC
        LIMIT 200
        """, Map.of("service", service))
        .list(r -> Map.of(
            "id", r.get("id").asString(""),
            "name", r.get("name").asString(""),
            "level", r.get("level").asInt(1),
            "sourceDocId", r.get("sourceDocId").asString("")));
  }
}

@Override
public Map<String, Object> getFocusSubgraph(String nodeId, int limit) {
  try (Session session = driver.session()) {
    // BFS up to 3 hops, score = 1 / (distance * 2)
    var result = session.run("""
        MATCH (center:Document {id: $nodeId})
        CALL {
          WITH center
          MATCH path = (center)-[*1..3]-(neighbor:Document)
          WHERE (neighbor.placeholder IS NULL OR neighbor.placeholder = false)
            AND neighbor.id IS NOT NULL AND neighbor.id <> $nodeId
          WITH neighbor, min(length(path)) AS distance
          RETURN neighbor, distance,
                 1.0 / (distance * 2.0) AS gravityScore
          ORDER BY gravityScore DESC
          LIMIT $limit
        }
        RETURN center.id AS centerId, center.title AS centerTitle,
               center.service AS centerService,
               collect({
                 id: neighbor.id,
                 label: coalesce(neighbor.title, neighbor.url),
                 service: coalesce(neighbor.service, ''),
                 gravityScore: gravityScore,
                 distance: distance
               }) AS nodes
        """, Map.of("nodeId", nodeId, "limit", limit))
        .list();

    if (result.isEmpty()) return Map.of();

    var r = result.get(0);
    @SuppressWarnings("unchecked")
    var nodes = (List<Map<String, Object>>) r.get("nodes").asList();
    var filteredNodes = nodes.stream()
        .filter(n -> {
          Object gs = n.get("gravityScore");
          return gs instanceof Number && ((Number) gs).doubleValue() >= 0.3;
        })
        .toList();

    var edges = filteredNodes.stream()
        .map(n -> Map.of(
            "source", r.get("centerId").asString(""),
            "target", n.get("id"),
            "weight", n.get("gravityScore")))
        .toList();

    return Map.of(
        "center", Map.of(
            "id", r.get("centerId").asString(""),
            "label", r.get("centerTitle").asString(""),
            "service", r.get("centerService").asString("")),
        "nodes", filteredNodes,
        "edges", edges);
  }
}
```

- [ ] **Step 7: Run all Java tests**

```bash
DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn test 2>&1 | grep -E "Tests run:|BUILD"
```

Expected: `BUILD SUCCESS`, all tests pass.

- [ ] **Step 8: Smoke test**

Restart Java (`mvn spring-boot:run` in api-service/), then:
```bash
curl -s http://localhost:8083/v1/graph/clusters | python3 -m json.tool | head -20
curl -s "http://localhost:8083/v1/graph/focus/$(curl -s http://localhost:8083/v1/graph/overview | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['nodes'][0]['id'])")" | python3 -m json.tool | head -20
```

Expected: clusters endpoint returns JSON with `clusters` array; focus endpoint returns `center` + `nodes` + `edges`.

- [ ] **Step 9: Commit**

```bash
git add api-service/src/
git commit -m "feat(galaxy): add GalaxyController + cluster/concept/focus Neo4j queries"
```

---

### Task 5: Frontend — SemanticGalaxy component

**Files:**
- Create: `web/components/galaxy/useGalaxyState.ts`
- Create: `web/components/galaxy/useGalaxyData.ts`
- Create: `web/components/galaxy/galaxyForceConfig.ts`
- Create: `web/components/galaxy/gravityUtils.ts`
- Create: `web/components/SemanticGalaxy.tsx`
- Modify: `web/app/graph/page.tsx`
- Modify: `web/lib/api.ts` — add 4 new fetch functions
- Modify: `web/lib/types.ts` — add GalaxyCluster, GalaxyFocusResponse types

**Interfaces:**
- Consumes: `/v1/graph/clusters`, `/v1/graph/focus/{nodeId}`, `/v1/graph/overview`
- Produces: `<SemanticGalaxy />` component used by `/graph` page

- [ ] **Step 1: Add types**

In `web/lib/types.ts`, add:
```typescript
export interface GalaxyCluster {
  id: string;
  label: string;
  nodeCount: number;
  services: string[];
  centroidId: string;
}

export interface GalaxyFocusNode {
  id: string;
  label: string;
  service: string;
  gravityScore: number;
  distance: number;
}

export interface GalaxyFocusResponse {
  center: { id: string; label: string; service: string };
  nodes: GalaxyFocusNode[];
  edges: Array<{ source: string; target: string; weight: number }>;
}
```

- [ ] **Step 2: Add API fetch functions**

In `web/lib/api.ts`, add:
```typescript
export async function fetchClusters() {
  return apiFetch<{ clusters: GalaxyCluster[] }>("/v1/graph/clusters", undefined, true);
}

export async function fetchFocusSubgraph(nodeId: string, limit = 50) {
  return apiFetch<GalaxyFocusResponse>(`/v1/graph/focus/${nodeId}?limit=${limit}`, undefined, true);
}

export function useClusters() {
  return useQuery({
    queryKey: ["galaxy", "clusters"],
    queryFn: fetchClusters,
    staleTime: 60 * 60 * 1000, // 1h
  });
}
```

- [ ] **Step 3: Create gravityUtils.ts**

Create `web/components/galaxy/gravityUtils.ts`:
```typescript
export function gravityToNodeSize(score: number, isFocal: boolean): number {
  if (isFocal) return 12;
  return 4 + score * 8; // 4–12 range
}

export function gravityToOpacity(score: number, isFocal: boolean): number {
  if (isFocal) return 1;
  if (score < 0.3) return 0.05;
  return 0.3 + score * 0.7; // 0.3–1.0 range
}

export function gravityToLinkStrength(score: number): number {
  return score * 0.8; // 0–0.8 range
}
```

- [ ] **Step 4: Create galaxyForceConfig.ts**

Create `web/components/galaxy/galaxyForceConfig.ts`:
```typescript
export interface ForceConfig {
  chargeStrength: number;
  linkDistance: number;
  linkStrength: number;
}

export const LEVEL_FORCE_CONFIG: Record<string, ForceConfig> = {
  universe: { chargeStrength: -120, linkDistance: 60, linkStrength: 0.3 },
  cluster:  { chargeStrength: -80,  linkDistance: 40, linkStrength: 0.5 },
  service:  { chargeStrength: -60,  linkDistance: 30, linkStrength: 0.6 },
  concept:  { chargeStrength: -40,  linkDistance: 20, linkStrength: 0.7 },
  gravity:  { chargeStrength: -100, linkDistance: 50, linkStrength: 0.8 },
};
```

- [ ] **Step 5: Create useGalaxyState.ts**

Create `web/components/galaxy/useGalaxyState.ts`:
```typescript
import { useState, useCallback } from "react";

export type GalaxyLevel =
  | { type: "overview" }
  | { type: "cluster"; clusterId: string; label: string }
  | { type: "service"; service: string }
  | { type: "gravity"; focalNodeId: string };

export function useGalaxyState() {
  const [stack, setStack] = useState<GalaxyLevel[]>([{ type: "overview" }]);
  const current = stack[stack.length - 1];

  const push = useCallback((level: GalaxyLevel) => {
    setStack((s) => [...s, level]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const reset = useCallback(() => {
    setStack([{ type: "overview" }]);
  }, []);

  return { current, stack, push, pop, reset, canGoBack: stack.length > 1 };
}
```

- [ ] **Step 6: Create useGalaxyData.ts**

Create `web/components/galaxy/useGalaxyData.ts`:
```typescript
import { useQuery } from "@tanstack/react-query";
import { fetchGraphOverview, fetchClusters, fetchFocusSubgraph } from "@/lib/api";
import type { GalaxyLevel } from "./useGalaxyState";
import type { GraphNode, GraphEdge } from "@/lib/types";

export interface GalaxyGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  isLoading: boolean;
  isError: boolean;
}

export function useGalaxyData(level: GalaxyLevel): GalaxyGraphData {
  const overviewQ = useQuery({
    queryKey: ["graph", "overview"],
    queryFn: fetchGraphOverview,
    enabled: level.type === "overview",
    staleTime: 24 * 60 * 60 * 1000,
  });

  const clustersQ = useQuery({
    queryKey: ["galaxy", "clusters"],
    queryFn: fetchClusters,
    enabled: level.type === "cluster" || level.type === "overview",
    staleTime: 60 * 60 * 1000,
  });

  const gravityQ = useQuery({
    queryKey: ["galaxy", "focus", level.type === "gravity" ? level.focalNodeId : ""],
    queryFn: () =>
      level.type === "gravity" ? fetchFocusSubgraph(level.focalNodeId) : null,
    enabled: level.type === "gravity",
    staleTime: 5 * 60 * 1000,
  });

  if (level.type === "gravity" && gravityQ.data) {
    const focalId = level.focalNodeId;
    const allNodes: GraphNode[] = [
      { id: gravityQ.data.center.id, url: "", title: gravityQ.data.center.label, service: gravityQ.data.center.service },
      ...gravityQ.data.nodes.map((n) => ({
        id: n.id, url: "", title: n.label, service: n.service,
      })),
    ];
    return {
      nodes: allNodes,
      edges: gravityQ.data.edges,
      isLoading: gravityQ.isLoading,
      isError: gravityQ.isError,
    };
  }

  // Default: overview
  return {
    nodes: overviewQ.data?.nodes ?? [],
    edges: overviewQ.data?.edges ?? [],
    isLoading: overviewQ.isLoading,
    isError: overviewQ.isError,
  };
}
```

- [ ] **Step 7: Create SemanticGalaxy.tsx**

Create `web/components/SemanticGalaxy.tsx`:
```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { useGalaxyState } from "./galaxy/useGalaxyState";
import { useGalaxyData } from "./galaxy/useGalaxyData";
import { gravityToNodeSize, gravityToOpacity } from "./galaxy/gravityUtils";
import { LEVEL_FORCE_CONFIG } from "./galaxy/galaxyForceConfig";
import type { GraphNode } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <div style={{ padding: 32 }}>Loading graph...</div>,
});

const SERVICE_PALETTE = [
  "#4285f4","#ea4335","#fbbc05","#34a853","#ff6d00",
  "#46bdc6","#9c27b0","#e91e63","#00bcd4","#8bc34a","#ff5722","#607d8b",
];

function serviceColor(service: string | null): string {
  if (!service) return "#999";
  let hash = 0;
  for (let i = 0; i < service.length; i++) {
    hash = (hash * 31 + service.charCodeAt(i)) & 0xffffff;
  }
  return SERVICE_PALETTE[Math.abs(hash) % SERVICE_PALETTE.length];
}

interface Props {
  width?: number;
  height?: number;
  onNodeNavigate?: (nodeId: string) => void;
}

export function SemanticGalaxy({ width = 1200, height = 700, onNodeNavigate }: Props) {
  const { current, push, pop, reset, canGoBack } = useGalaxyState();
  const { nodes, edges, isLoading, isError } = useGalaxyData(current);

  const forceConfig = LEVEL_FORCE_CONFIG[
    current.type === "gravity" ? "gravity" : current.type === "overview" ? "universe" : "cluster"
  ];

  const focalNodeId = current.type === "gravity" ? current.focalNodeId : null;

  const handleNodeClick = useCallback(
    (node: object) => {
      const n = node as GraphNode;
      if (!n.id) return;
      // Single click: activate gravity
      push({ type: "gravity", focalNodeId: n.id });
    },
    [push]
  );

  const handleBackgroundClick = useCallback(() => {
    if (current.type === "gravity") pop();
  }, [current, pop]);

  const nodeVal = useCallback(
    (node: object) => {
      const n = node as GraphNode;
      if (focalNodeId) {
        return gravityToNodeSize(0.5, n.id === focalNodeId);
      }
      return 4;
    },
    [focalNodeId]
  );

  const nodeColor = useCallback(
    (node: object) => {
      const n = node as GraphNode;
      const base = serviceColor(n.service);
      if (!focalNodeId) return base;
      // Dim non-focal nodes — we encode opacity in color alpha channel
      if (n.id === focalNodeId) return base;
      return base + "66"; // ~40% opacity via hex alpha
    },
    [focalNodeId]
  );

  if (isLoading) return <div style={{ padding: 32 }}>Loading galaxy...</div>;
  if (isError) return <div style={{ padding: 32, color: "#c00" }}>Failed to load graph.</div>;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const validLinks = edges
    .map((e) => {
      const src = nodeIds.has(e.source) ? e.source : null;
      const tgt = nodeIds.has(e.target) ? e.target : null;
      if (!src || !tgt) return null;
      return { source: src, target: tgt };
    })
    .filter(Boolean);

  return (
    <div style={{ position: "relative" }}>
      {canGoBack && (
        <button
          onClick={pop}
          style={{
            position: "absolute", top: 16, left: 16, zIndex: 10,
            padding: "6px 14px", background: "#fff", border: "1px solid #ddd",
            borderRadius: 6, cursor: "pointer", fontSize: 13,
          }}
        >
          ← Back
        </button>
      )}
      <ForceGraph2D
        graphData={{ nodes, links: validLinks }}
        nodeColor={nodeColor}
        nodeVal={nodeVal}
        nodeLabel={(node) => {
          const n = node as GraphNode;
          return n.title ?? n.url ?? n.id;
        }}
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
        d3VelocityDecay={0.3}
        width={width}
        height={height}
      />
    </div>
  );
}
```

- [ ] **Step 8: Update /graph/page.tsx to use SemanticGalaxy**

Replace `web/app/graph/page.tsx`:
```tsx
"use client";

import { SemanticGalaxy } from "@/components/SemanticGalaxy";
import { useRouter } from "next/navigation";

export default function GraphPage() {
  const router = useRouter();

  return (
    <main>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>AWS Docs Galaxy</h1>
        <p style={{ color: "#888", fontSize: 14, margin: "4px 0 0" }}>
          Click a node to focus · click background to reset
        </p>
      </div>
      <SemanticGalaxy
        width={typeof window !== "undefined" ? window.innerWidth : 1200}
        height={typeof window !== "undefined" ? window.innerHeight - 80 : 700}
        onNodeNavigate={(id) => router.push(`/graph/${id}`)}
      />
    </main>
  );
}
```

- [ ] **Step 9: Run frontend tests**

```bash
cd web && npm test 2>&1 | tail -6
```

Expected: all existing tests pass (new components don't have unit tests yet — graph page test will need updating if it breaks).

- [ ] **Step 10: Check in browser**

Navigate to http://localhost:3000/graph. Verify:
- Graph renders with nodes
- Click a node → gravity activates, non-connected nodes dim
- Click background → graph resets
- Back button appears when in gravity mode

- [ ] **Step 11: Commit**

```bash
git add web/
git commit -m "feat(galaxy): add SemanticGalaxy component with state machine + gravity"
```

---

### Task 6: Wire concept extraction into ingest pipeline + run clustering

**Files:**
- Modify: `agent-service/app/ingest/sitemap.py` — call extract-concepts after ingest

**Interfaces:**
- Consumes: `POST /internal/graph/extract-concepts`, `POST /internal/graph/run-clustering`
- Produces: concepts auto-extracted after each sitemap run; clustering run once manually

- [ ] **Step 1: Run clustering manually to seed community_ids**

With Python service running:
```bash
curl -s -X POST http://localhost:8001/internal/graph/run-clustering | python3 -m json.tool
```

Expected:
```json
{"communities": 8, "nodes_assigned": 1700}
```

- [ ] **Step 2: Run concept extraction manually**

```bash
curl -s -X POST http://localhost:8001/internal/graph/extract-concepts | python3 -m json.tool
```

Expected:
```json
{"docs_processed": 200, "concepts_created": 1500}
```

- [ ] **Step 3: Verify in Neo4j**

```bash
export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock
docker exec $(docker ps -q --filter name=neo4j) cypher-shell -u neo4j -p devpassword \
  "MATCH (c:Concept) RETURN count(c)" 2>&1
docker exec $(docker ps -q --filter name=neo4j) cypher-shell -u neo4j -p devpassword \
  "MATCH (d:Document) WHERE d.community_id IS NOT NULL RETURN count(d)" 2>&1
```

Expected: ≥500 concepts, ≥1000 nodes with community_id.

- [ ] **Step 4: Verify clusters endpoint**

Restart Java service, then:
```bash
curl -s http://localhost:8083/v1/graph/clusters | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'Found {len(d[\"clusters\"])} clusters')
for c in d['clusters'][:3]:
    print(f'  {c[\"id\"]}: {c[\"label\"]} ({c[\"nodeCount\"]} nodes, services: {c[\"services\"][:3]})')
"
```

Expected: 5–15 clusters listed with service names.

- [ ] **Step 5: Commit**

```bash
git add agent-service/
git commit -m "feat(galaxy): wire concept extraction + manual clustering seed"
```

---

## Validation Checklist (from spec §7)

- [ ] `/graph` renders Level 0 view with nodes grouped visually by community, colour-coded
- [ ] Click a node → semantic gravity activates, graph re-weights
- [ ] Click background → gravity deactivates, graph restores
- [ ] Back button restores previous view
- [ ] `POST /internal/graph/run-clustering` assigns `community_id` to ≥90% of non-placeholder Document nodes
- [ ] `POST /internal/graph/extract-concepts` creates `:Concept` nodes for ≥80% of processed docs
- [ ] `GET /v1/graph/clusters` returns clusters with labels and service lists
- [ ] `GET /v1/graph/focus/{nodeId}` returns nodes with gravityScore ≥ 0.3 only
