# Learning Galaxy — Design

**Status:** Approved, ready for implementation planning
**Date:** 2026-07-28
**Author:** Brainstorm session (user + Claude)
**Project:** aws-docs-graph

---

## 1. Goal

Add a "My Learning" mode to the galaxy view — a personal knowledge graph that grows as the user asks questions. Inspired by Obsidian's graph view: each cited doc becomes a node, edges form between docs cited together, and the graph visualizes the user's AWS learning journey.

---

## 2. Scope

**In scope:**
- `app.user_visits` Postgres table — track which docs each user has been "taught" (via citations)
- Java `QueryService` — write citations to `user_visits` after each successful query
- `GET /v1/graph/my-learning` Java endpoint — return user's personal doc graph
- Galaxy toggle "All AWS / My Learning" — switch between full galaxy and personal Obsidian-style graph
- Empty state when user has no visits yet

**Out of scope:**
- User authentication (uses dev fallback user in local)
- Per-user Neo4j graph layer (uses Postgres only)
- Learning mode with quiz/progress tracking (separate spec)
- CO_RETURNED edges per-user (uses global CO_RETURNED)

---

## 3. Data Model

### 3.1 New Postgres table

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

### 3.2 Write logic

After each successful query in `QueryService.java`, upsert citations into `user_visits`:
```sql
INSERT INTO app.user_visits (user_id, doc_url, doc_title, service)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, doc_url) DO UPDATE
  SET visit_count = user_visits.visit_count + 1,
      last_visited_at = now()
```

---

## 4. API

### `GET /v1/graph/my-learning`

Returns the user's personal doc graph — nodes from `user_visits`, edges from `query_citations` co-citations.

**Response:**
```json
{
  "nodes": [
    {
      "id": "uuid",
      "url": "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html",
      "title": "What is AWS Lambda?",
      "service": "lambda",
      "visitCount": 3,
      "firstVisitedAt": "2026-07-28T10:00:00Z"
    }
  ],
  "edges": [
    {
      "source": "uuid-lambda",
      "target": "uuid-s3",
      "weight": 2
    }
  ],
  "totalDocs": 12,
  "totalQueries": 5
}
```

**Edge logic:** Two docs are connected if they appear together in the same query's citations. Edge `weight` = number of queries where both appeared.

**Cypher for edges (Neo4j not needed — pure SQL):**
```sql
SELECT qc1.document_id AS src, qc2.document_id AS tgt, COUNT(*) AS weight
FROM app.query_citations qc1
JOIN app.query_citations qc2
  ON qc1.query_id = qc2.query_id AND qc1.document_id < qc2.document_id
JOIN app.queries q ON q.id = qc1.query_id AND q.user_id = $userId
GROUP BY qc1.document_id, qc2.document_id
HAVING COUNT(*) >= 1
```

---

## 5. Frontend

### 5.1 Toggle

Add to galaxy page header:
```tsx
<div style={{ display: "flex", gap: 8 }}>
  <button
    onClick={() => setMode("all")}
    style={{ background: mode === "all" ? "#4285f4" : "transparent" }}
  >
    All AWS
  </button>
  <button
    onClick={() => setMode("learning")}
    style={{ background: mode === "learning" ? "#34a853" : "transparent" }}
  >
    My Learning
  </button>
</div>
```

### 5.2 My Learning view

Uses **react-force-graph-2d** (2D, not 3D) — same library already in project.

```
Dark background (#0a0a1a)
Node: circle, color = serviceColor(service), size ∝ visitCount
Label: doc title on hover
Edge: thin line, opacity ∝ weight
```

**Node size formula:** `4 + Math.log(visitCount + 1) * 4` → 4px (1 visit) to ~12px (10+ visits)

### 5.3 Empty state

```tsx
<div style={{ textAlign: "center", padding: 80, color: "#666" }}>
  <p style={{ fontSize: 48 }}>🌱</p>
  <h2>Your learning graph is empty</h2>
  <p>Ask questions at /ask to start building it.</p>
  <a href="/ask">Go to /ask →</a>
</div>
```

---

## 6. Validation criteria

1. After asking "What is Lambda?", `user_visits` has ≥1 row for the user
2. `GET /v1/graph/my-learning` returns nodes matching `user_visits`
3. After 2 queries citing same doc, `visitCount` = 2
4. After 2 queries citing docs A+B together, edge A-B exists with weight=2
5. Toggle "My Learning" on /galaxy shows 2D graph with visited docs
6. Empty state shown when user has no visits
