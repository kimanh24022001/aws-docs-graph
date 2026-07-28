# Learning Galaxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "My Learning" toggle to the galaxy view — a personal Obsidian-style knowledge graph that grows as the user asks questions, showing only the AWS docs they've been taught via citations.

**Architecture:** Postgres `app.user_visits` table tracks cited docs per user. Java `QueryService` upserts citations after each query. A new `GET /v1/graph/my-learning` endpoint returns the user's personal graph. The galaxy page adds a toggle that switches between the full 3D galaxy and a 2D force-directed personal graph.

**Tech Stack:** Flyway SQL | Java 21 + Spring Boot 3 + Spring JDBC | Next.js 15 + react-force-graph-2d

## Global Constraints

- Working directory: `/Users/I753472/Documents/development/aws-docs-graph`
- Postgres migration: `infra/migrations/postgres/V8__user_visits.sql`
- Local dev: run `make migrate-postgres` to apply (uses Docker via `DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock`)
- Java service: `api-service/`, port 8083 locally
- Frontend: `web/`, Next.js 15 App Router, TanStack Query v5
- Dev fallback user ID: `00000000-0000-0000-0000-000000000001`
- Node size formula: `4 + Math.log(visitCount + 1) * 4` (pixels)
- Empty state text: "Your learning graph is empty. Ask questions at /ask to start building it."
- Toggle labels: "All AWS" and "My Learning"
- My Learning uses **2D** react-force-graph-2d, not 3D

---

## File Structure

```
infra/migrations/postgres/
└── V8__user_visits.sql                    NEW — user_visits table

api-service/src/main/java/com/awsdocs/
├── application/port/out/
│   └── GraphRepository.java               MODIFY — add getMyLearning()
│   └── UserVisitsRepository.java          NEW — port for user_visits writes
├── adapter/out/persistence/
│   └── UserVisitsRepositoryImpl.java      NEW — upsertVisits() implementation
├── adapter/out/graph/
│   └── Neo4jGraphClient.java              MODIFY — add getMyLearning() (pure SQL, no Neo4j)
├── adapter/in/rest/
│   └── GalaxyController.java             MODIFY — add GET /v1/graph/my-learning
└── application/service/
    └── QueryService.java                  MODIFY — call upsertVisits() after success

web/
├── app/galaxy/page.tsx                    MODIFY — add mode toggle + My Learning view
└── lib/api.ts                             MODIFY — add fetchMyLearning()
```

---

### Task 1: Postgres migration + Java UserVisitsRepository

**Files:**
- Create: `infra/migrations/postgres/V8__user_visits.sql`
- Create: `api-service/src/main/java/com/awsdocs/application/port/out/UserVisitsRepository.java`
- Create: `api-service/src/main/java/com/awsdocs/adapter/out/persistence/UserVisitsRepositoryImpl.java`

**Interfaces:**
- Produces:
  - `UserVisitsRepository.upsertVisit(userId: String, docUrl: String, docTitle: String, service: String): void`

- [ ] **Step 1: Create migration**

Create `infra/migrations/postgres/V8__user_visits.sql`:
```sql
CREATE TABLE app.user_visits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  doc_url          text NOT NULL,
  doc_title        text,
  service          text,
  visit_count      int NOT NULL DEFAULT 1,
  last_visited_at  timestamptz NOT NULL DEFAULT now(),
  first_visited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, doc_url)
);

CREATE INDEX user_visits_user_idx ON app.user_visits(user_id);
```

- [ ] **Step 2: Apply migration locally**

```bash
export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock
cd /Users/I753472/Documents/development/aws-docs-graph && make migrate-postgres
```

Expected output includes:
```
Migrating schema "app" to version "8 - user visits"
Successfully applied 1 migration to schema "app", now at version v8
```

- [ ] **Step 3: Create port interface**

Create `api-service/src/main/java/com/awsdocs/application/port/out/UserVisitsRepository.java`:
```java
package com.awsdocs.application.port.out;

public interface UserVisitsRepository {
  void upsertVisit(String userId, String docUrl, String docTitle, String service);
}
```

- [ ] **Step 4: Implement repository**

Create `api-service/src/main/java/com/awsdocs/adapter/out/persistence/UserVisitsRepositoryImpl.java`:
```java
package com.awsdocs.adapter.out.persistence;

import com.awsdocs.application.port.out.UserVisitsRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserVisitsRepositoryImpl implements UserVisitsRepository {

  private final JdbcTemplate jdbc;

  public UserVisitsRepositoryImpl(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public void upsertVisit(String userId, String docUrl, String docTitle, String service) {
    jdbc.update(
        """
        INSERT INTO app.user_visits (user_id, doc_url, doc_title, service)
        VALUES (?::uuid, ?, ?, ?)
        ON CONFLICT (user_id, doc_url) DO UPDATE
          SET visit_count = app.user_visits.visit_count + 1,
              last_visited_at = now(),
              doc_title = EXCLUDED.doc_title
        """,
        userId, docUrl, docTitle != null ? docTitle : "", service != null ? service : "");
  }
}
```

- [ ] **Step 5: Compile check**

```bash
cd api-service && DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn -q compile 2>&1 | tail -3 && echo "OK"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add infra/migrations/postgres/V8__user_visits.sql api-service/src/
git commit -m "feat(learning): add user_visits migration and repository"
```

---

### Task 2: Wire upsertVisit into QueryService

**Files:**
- Modify: `api-service/src/main/java/com/awsdocs/application/service/QueryService.java`
- Test: `api-service/src/test/java/com/awsdocs/application/service/QueryServiceTest.java`

**Interfaces:**
- Consumes: `UserVisitsRepository.upsertVisit(userId, docUrl, docTitle, service)` from Task 1
- Consumes: `QueryResult.citations()` — `List<Map<String, Object>>`, each map has keys `url`, `title`, `service`

- [ ] **Step 1: Read current QueryService**

Open `api-service/src/main/java/com/awsdocs/application/service/QueryService.java` and note the `submit()` method — after `queryRepository.markSucceeded(queryId, userId, result)` is where we add visit upserts.

- [ ] **Step 2: Write failing test**

In `api-service/src/test/java/com/awsdocs/application/service/QueryServiceTest.java`, add:
```java
@Mock UserVisitsRepository userVisitsRepository;

@Test
void submit_upserts_visits_for_each_citation() {
  var queryId = UUID.randomUUID();
  var citation = new java.util.HashMap<String, Object>();
  citation.put("url", "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html");
  citation.put("title", "What is Lambda?");
  citation.put("service", "lambda");
  var expected = new QueryResult(queryId.toString(), "Answer",
      List.of(citation), List.of(), Map.of());

  when(queryRepository.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
  when(queryRepository.getDailyLlmCostForUser(any())).thenReturn(0.0);
  when(queryRepository.createPending(any(), any(), any(), any())).thenReturn(queryId);
  when(agentServicePort.runAgent(any(), any(), any(), any())).thenReturn(expected);

  queryService.submit(new QueryRequest("user1", "org1", "test?", "k1"));

  verify(userVisitsRepository).upsertVisit(
      "user1",
      "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html",
      "What is Lambda?",
      "lambda");
}
```

- [ ] **Step 3: Run test — verify FAIL**

```bash
cd api-service && DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn test -Dtest=QueryServiceTest#submit_upserts_visits_for_each_citation 2>&1 | tail -5
```

Expected: COMPILATION ERROR or FAIL — `userVisitsRepository` not wired.

- [ ] **Step 4: Update QueryService**

In `QueryService.java`:
1. Add constructor parameter: `private final UserVisitsRepository userVisitsRepository;`
2. After `queryRepository.markSucceeded(queryId, userId, result);`, add:
```java
// Upsert user visits for each cited doc (learning graph)
if (result.citations() != null) {
  for (var citation : result.citations()) {
    var url = (String) citation.get("url");
    var title = (String) citation.get("title");
    var service = (String) citation.get("service");
    if (url != null && !url.isBlank()) {
      try {
        userVisitsRepository.upsertVisit(request.userId(), url, title, service);
      } catch (Exception e) {
        // non-fatal — don't fail the query if visit tracking fails
      }
    }
  }
}
```

- [ ] **Step 5: Run tests — verify PASS**

```bash
DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn test -Dtest=QueryServiceTest 2>&1 | grep -E "Tests run:|BUILD"
```

Expected: `BUILD SUCCESS`, all tests pass.

- [ ] **Step 6: Smoke test — verify visits written**

Restart Java, ask a question, check DB:
```bash
curl -s -X POST http://localhost:8083/v1/queries \
  -H "Content-Type: application/json" \
  -d '{"question":"What is Amazon S3?","idempotencyKey":"visit-test-1"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('citations:', len(d.get('citations',[])), 'answer[:50]:', d.get('answer','')[:50])"
```

Then check DB:
```bash
export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock
docker exec $(docker ps -q --filter name=postgres) psql -U postgres -c \
  "SELECT doc_url, doc_title, service, visit_count FROM app.user_visits WHERE user_id='00000000-0000-0000-0000-000000000001' LIMIT 5"
```

Expected: rows with doc URLs from the S3 query.

- [ ] **Step 7: Commit**

```bash
git add api-service/src/
git commit -m "feat(learning): upsert user_visits after each successful query"
```

---

### Task 3: GET /v1/graph/my-learning Java endpoint

**Files:**
- Modify: `api-service/src/main/java/com/awsdocs/application/port/out/GraphRepository.java` — add `getMyLearning()`
- Modify: `api-service/src/main/java/com/awsdocs/adapter/out/graph/Neo4jGraphClient.java` — implement (pure SQL via JdbcTemplate)
- Modify: `api-service/src/main/java/com/awsdocs/adapter/in/rest/GalaxyController.java` — expose endpoint
- Create: `api-service/src/test/java/com/awsdocs/adapter/in/rest/MyLearningControllerTest.java`

**Interfaces:**
- Consumes: `app.user_visits` table and `app.query_citations` + `app.queries` tables (written in Task 2)
- Produces:
  - `GET /v1/graph/my-learning` → `{"nodes":[{"id","url","title","service","visitCount","firstVisitedAt"}], "edges":[{"source","target","weight"}], "totalDocs":int, "totalQueries":int}`

- [ ] **Step 1: Add port method**

In `GraphRepository.java`, add:
```java
Map<String, Object> getMyLearning(String userId);
```

- [ ] **Step 2: Write controller test**

Create `api-service/src/test/java/com/awsdocs/adapter/in/rest/MyLearningControllerTest.java`:
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
class MyLearningControllerTest {

  @Autowired MockMvc mockMvc;
  @MockBean GraphRepository graphRepository;

  @Test
  void my_learning_returns_nodes_and_edges() throws Exception {
    when(graphRepository.getMyLearning("00000000-0000-0000-0000-000000000001"))
        .thenReturn(Map.of(
            "nodes", List.of(Map.of(
                "id", "uuid-1",
                "url", "https://docs.aws.amazon.com/lambda/welcome.html",
                "title", "What is Lambda?",
                "service", "lambda",
                "visitCount", 2,
                "firstVisitedAt", "2026-07-28T00:00:00Z")),
            "edges", List.of(),
            "totalDocs", 1,
            "totalQueries", 1));

    mockMvc.perform(get("/v1/graph/my-learning")
            .header("X-User-Id", "00000000-0000-0000-0000-000000000001"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.nodes[0].service").value("lambda"))
        .andExpect(jsonPath("$.nodes[0].visitCount").value(2))
        .andExpect(jsonPath("$.totalDocs").value(1));
  }

  @Test
  void my_learning_returns_empty_for_new_user() throws Exception {
    when(graphRepository.getMyLearning("00000000-0000-0000-0000-000000000002"))
        .thenReturn(Map.of("nodes", List.of(), "edges", List.of(), "totalDocs", 0, "totalQueries", 0));

    mockMvc.perform(get("/v1/graph/my-learning")
            .header("X-User-Id", "00000000-0000-0000-0000-000000000002"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalDocs").value(0));
  }
}
```

- [ ] **Step 3: Run test — verify FAIL**

```bash
DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn test -Dtest=MyLearningControllerTest 2>&1 | tail -5
```

Expected: COMPILATION ERROR — `getMyLearning` not implemented.

- [ ] **Step 4: Implement Neo4j/SQL query**

In `Neo4jGraphClient.java`, add (uses JdbcTemplate injected in constructor, not neo4j driver):

First add `JdbcTemplate jdbc` field and constructor injection alongside existing `Driver driver`.

Then add:
```java
@Override
public Map<String, Object> getMyLearning(String userId) {
  // Nodes: docs the user has visited
  var nodes = jdbc.queryForList(
      """
      SELECT id::text, doc_url AS url, doc_title AS title, service,
             visit_count AS "visitCount",
             first_visited_at AS "firstVisitedAt"
      FROM app.user_visits
      WHERE user_id = ?::uuid
      ORDER BY visit_count DESC, last_visited_at DESC
      LIMIT 200
      """, userId);

  // Edges: pairs of docs cited together in same query
  var edges = jdbc.queryForList(
      """
      SELECT qc1.document_id::text AS source,
             qc2.document_id::text AS target,
             COUNT(*) AS weight
      FROM app.query_citations qc1
      JOIN app.query_citations qc2
        ON qc1.query_id = qc2.query_id
        AND qc1.document_id < qc2.document_id
      JOIN app.queries q ON q.id = qc1.query_id
      WHERE q.user_id = ?::uuid AND q.status = 'succeeded'
      GROUP BY qc1.document_id, qc2.document_id
      HAVING COUNT(*) >= 1
      LIMIT 500
      """, userId);

  // Filter edges to only include nodes we have in user_visits
  var nodeIds = nodes.stream()
      .map(n -> (String) n.get("id"))
      .collect(java.util.stream.Collectors.toSet());
  var filteredEdges = edges.stream()
      .filter(e -> nodeIds.contains(e.get("source")) && nodeIds.contains(e.get("target")))
      .toList();

  int totalQueries = jdbc.queryForObject(
      "SELECT COUNT(*) FROM app.queries WHERE user_id = ?::uuid AND status = 'succeeded'",
      Integer.class, userId);

  return Map.of(
      "nodes", nodes,
      "edges", filteredEdges,
      "totalDocs", nodes.size(),
      "totalQueries", totalQueries != null ? totalQueries : 0);
}
```

**Note:** `Neo4jGraphClient` currently only has `Driver driver`. Add `JdbcTemplate jdbc` field:
```java
private final Driver driver;
private final JdbcTemplate jdbc;

public Neo4jGraphClient(Driver driver, JdbcTemplate jdbc) {
  this.driver = driver;
  this.jdbc = jdbc;
}
```

- [ ] **Step 5: Add endpoint to GalaxyController**

In `GalaxyController.java`, add:
```java
@GetMapping("/my-learning")
public Map<String, Object> myLearning(HttpServletRequest request) {
  var userId = request.getHeader("X-User-Id");
  if (userId == null || userId.isBlank()) userId = "00000000-0000-0000-0000-000000000001";
  return graphRepository.getMyLearning(userId);
}
```

Also add `import jakarta.servlet.http.HttpServletRequest;` if not present.

- [ ] **Step 6: Run all Java tests**

```bash
DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn test 2>&1 | grep -E "Tests run:|BUILD"
```

Expected: `BUILD SUCCESS`, all tests pass.

- [ ] **Step 7: Smoke test endpoint**

Restart Java, then:
```bash
curl -s "http://localhost:8083/v1/graph/my-learning" \
  -H "X-User-Id: 00000000-0000-0000-0000-000000000001" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('nodes:', d['totalDocs'], 'queries:', d['totalQueries'])
for n in d['nodes'][:3]:
    print(' -', n.get('service'), n.get('visitCount'), 'visits:', n.get('title','')[:40])
"
```

Expected: nodes from previous smoke test in Task 2.

- [ ] **Step 8: Commit**

```bash
git add api-service/src/
git commit -m "feat(learning): add GET /v1/graph/my-learning endpoint"
```

---

### Task 4: Frontend toggle + My Learning 2D view

**Files:**
- Modify: `web/lib/api.ts` — add `fetchMyLearning()`
- Modify: `web/app/galaxy/page.tsx` — add mode state, toggle buttons, MyLearningView component

**Interfaces:**
- Consumes: `GET /v1/graph/my-learning` → `{nodes, edges, totalDocs, totalQueries}` (from Task 3)
- Node shape: `{id, url, title, service, visitCount, firstVisitedAt}`
- Edge shape: `{source, target, weight}`

- [ ] **Step 1: Add fetchMyLearning to api.ts**

In `web/lib/api.ts`, add after `fetchServiceEvidenceEdges`:
```typescript
export interface MyLearningNode {
  id: string;
  url: string;
  title: string;
  service: string;
  visitCount: number;
  firstVisitedAt: string;
}

export interface MyLearningResponse {
  nodes: MyLearningNode[];
  edges: { source: string; target: string; weight: number }[];
  totalDocs: number;
  totalQueries: number;
}

export async function fetchMyLearning(): Promise<MyLearningResponse> {
  return apiFetch<MyLearningResponse>("/v1/graph/my-learning", undefined, false);
}
```

- [ ] **Step 2: Add mode state and toggle to galaxy page**

In `web/app/galaxy/page.tsx`, in the `GalaxyPage` component, add after existing state:
```typescript
const [galaxyMode, setGalaxyMode] = useState<"all" | "learning">("all");

const myLearningQ = useQuery({
  queryKey: ["galaxy", "my-learning"],
  queryFn: fetchMyLearning,
  enabled: galaxyMode === "learning",
  staleTime: 30_000,
});
```

Also add `fetchMyLearning` to the import from `@/lib/api`.

- [ ] **Step 3: Add toggle buttons to header**

Find the header div in the return statement and add the toggle after the title:
```tsx
{/* Mode toggle */}
<div style={{ display: "flex", gap: 4, marginLeft: "auto", pointerEvents: "all" }}>
  {(["all", "learning"] as const).map((m) => (
    <button
      key={m}
      onClick={() => setGalaxyMode(m)}
      style={{
        padding: "4px 12px",
        fontSize: 12,
        borderRadius: 4,
        border: "1px solid #333",
        cursor: "pointer",
        background: galaxyMode === m ? (m === "all" ? "#4285f4" : "#34a853") : "rgba(255,255,255,0.05)",
        color: galaxyMode === m ? "#fff" : "#888",
        fontWeight: galaxyMode === m ? 600 : 400,
      }}
    >
      {m === "all" ? "All AWS" : "My Learning"}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Add MyLearningView**

Add this component before the `GalaxyPage` function (after the `DocScene` function):
```tsx
import dynamic from "next/dynamic";
const ForceGraph2DFlat = dynamic(() => import("react-force-graph-2d"), { ssr: false });

function MyLearningView({ data, width, height }: { data: MyLearningResponse | undefined; width: number; height: number }) {
  if (!data || data.totalDocs === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height, color: "#666", gap: 16 }}>
        <div style={{ fontSize: 48 }}>🌱</div>
        <h2 style={{ color: "#aaa", margin: 0 }}>Your learning graph is empty</h2>
        <p style={{ margin: 0 }}>Ask questions at /ask to start building it.</p>
        <a href="/ask" style={{ color: "#34a853", textDecoration: "none" }}>Go to /ask →</a>
      </div>
    );
  }

  const graphData = {
    nodes: data.nodes.map((n) => ({
      id: n.id,
      label: n.title || n.url,
      service: n.service,
      visitCount: n.visitCount,
      color: categoryColor(categoryFor(n.service)),
      val: 4 + Math.log(n.visitCount + 1) * 4,
    })),
    links: data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      value: e.weight,
    })),
  };

  return (
    <ForceGraph2DFlat
      graphData={graphData}
      backgroundColor="#0a0a1a"
      nodeColor={(n) => (n as { color: string }).color}
      nodeVal={(n) => (n as { val: number }).val}
      nodeLabel={(n) => (n as { label: string }).label}
      linkColor={() => "#2a3a4a"}
      linkWidth={(l) => Math.max(0.5, (l as { value: number }).value * 0.5)}
      width={width}
      height={height}
    />
  );
}
```

- [ ] **Step 5: Render MyLearningView when mode is "learning"**

In the Canvas section of `GalaxyPage`, wrap the existing Canvas with a conditional:
```tsx
{galaxyMode === "learning" ? (
  <MyLearningView data={myLearningQ.data} width={width} height={height} />
) : (
  <Canvas camera={{ position: [0, 20, 60], fov: 45 }} frameloop="always">
    {/* existing canvas content */}
  </Canvas>
)}
```

- [ ] **Step 6: Verify in browser**

1. Open http://localhost:3000/galaxy
2. Click "My Learning" toggle — should show empty state (if no queries asked yet) or 2D graph
3. Ask a question at http://localhost:3000/ask ("What is Amazon S3?")
4. Return to /galaxy, click "My Learning" → should show S3 docs as nodes
5. Ask another question — nodes should update and edges appear if docs co-cited

- [ ] **Step 7: Commit**

```bash
git add web/
git commit -m "feat(learning): add My Learning toggle and 2D personal knowledge graph"
```

---

## Validation Checklist (from spec §6)

- [ ] After asking "What is Lambda?", `app.user_visits` has ≥1 row for the user
- [ ] `GET /v1/graph/my-learning` returns nodes matching `user_visits`
- [ ] After 2 queries citing same doc, `visitCount` = 2
- [ ] After 2 queries citing docs A+B together, edge A-B exists with weight ≥ 1
- [ ] Toggle "My Learning" on /galaxy shows 2D graph with visited docs
- [ ] Empty state shown when user has no visits
