# Entity Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize AWS service entity names across Postgres and Neo4j — merge duplicate names to canonical form, group SDK docs under a new `sdk` category, and expose a one-shot migration endpoint.

**Architecture:** Python expands `_normalize_service()` and adds a new `standardize.py` migration endpoint that batch-updates both Postgres and Neo4j. Java adds SDK to `ServiceCategory`. Frontend adds SDK category + color. Migration is idempotent.

**Tech Stack:** Python 3.12 + asyncpg + neo4j-driver | Java 21 + Spring Boot 3 | TypeScript + Next.js 15

## Global Constraints

- Working directory: `/Users/I753472/Documents/development/aws-docs-graph`
- Python service venv: `agent-service/.venv/` — activate with `source agent-service/.venv/bin/activate`
- Canonical names are all lowercase, no spaces: `ec2`, `s3`, `sdk`, etc.
- Migration endpoint is idempotent — safe to call multiple times
- SDK canonical name: `"sdk"` (not "SDK" — that is the category label, not the service name)
- New category label: `"SDK"` with color `"#78909c"` (grey)
- Docker: `export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock`

---

## File Structure

```
agent-service/app/ingest/page.py          MODIFY — add aliases to _SERVICE_ALIASES
agent-service/app/graph/standardize.py    CREATE — migration endpoint
agent-service/app/main.py                 MODIFY — register standardize router
agent-service/tests/unit/
  test_normalize.py                       CREATE — unit tests for _normalize_service
  test_graph/test_standardize.py          CREATE — unit test for CANONICAL_MAP

api-service/src/main/java/com/awsdocs/
  domain/model/ServiceCategory.java      MODIFY — add sdk + fallback mappings

web/lib/categories.ts                     MODIFY — add sdk to SERVICE_TO_CATEGORY + CATEGORY_COLORS
```

---

### Task 1: Expand `_normalize_service()` + unit tests

**Files:**
- Modify: `agent-service/app/ingest/page.py` — add 8 new aliases to `_SERVICE_ALIASES`
- Create: `agent-service/tests/unit/test_normalize.py`

**Interfaces:**
- Produces: `_normalize_service(raw: str) -> str` — existing function, expanded aliases

- [ ] **Step 1: Write failing tests**

Create `agent-service/tests/unit/test_normalize.py`:
```python
from app.ingest.page import _normalize_service


def test_awsec2_normalizes_to_ec2():
    assert _normalize_service("awsec2") == "ec2"


def test_sdkfornet_normalizes_to_sdk():
    assert _normalize_service("sdkfornet") == "sdk"


def test_awsjavasdk_normalizes_to_sdk():
    assert _normalize_service("awsjavasdk") == "sdk"


def test_aws_sdk_php_normalizes_to_sdk():
    assert _normalize_service("aws-sdk-php") == "sdk"


def test_awssdkforphp_normalizes_to_sdk():
    assert _normalize_service("awssdkforphp") == "sdk"


def test_embedded_csdk_normalizes_to_sdk():
    assert _normalize_service("embedded-csdk") == "sdk"


def test_freertos_normalizes_to_sdk():
    assert _normalize_service("freertos") == "sdk"


def test_code_library_normalizes_to_sdk():
    assert _normalize_service("code-library") == "sdk"


def test_existing_s3_unchanged():
    # Regression: existing normalizations must still work
    assert _normalize_service("amazons3") == "s3"


def test_unknown_passthrough():
    assert _normalize_service("someservice") == "someservice"
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
cd agent-service && source .venv/bin/activate
pytest tests/unit/test_normalize.py -v
```
Expected: `FAILED` — `awsec2` returns `"awsec2"` not `"ec2"`.

- [ ] **Step 3: Add aliases to `_SERVICE_ALIASES`**

In `agent-service/app/ingest/page.py`, find `_SERVICE_ALIASES = {` and add inside the dict:
```python
    "awsec2": "ec2",
    "sdkfornet": "sdk",
    "awsjavasdk": "sdk",
    "aws-sdk-php": "sdk",
    "awssdkforphp": "sdk",
    "embedded-csdk": "sdk",
    "freertos": "sdk",
    "code-library": "sdk",
    "appstudio": "sdk",
    "aws-sdk-go": "sdk",
    "aws-sdk-pandas": "sdk",
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
pytest tests/unit/test_normalize.py -v
```
Expected: 10 passed.

- [ ] **Step 5: Run full unit suite to check regressions**

```bash
pytest tests/unit/ -v 2>&1 | tail -8
```
Expected: all previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add agent-service/app/ingest/page.py agent-service/tests/unit/test_normalize.py
git commit -m "feat(entities): expand _normalize_service with SDK + awsec2 aliases"
```

---

### Task 2: Migration endpoint `POST /internal/graph/standardize-entities`

**Files:**
- Create: `agent-service/app/graph/standardize.py`
- Create: `agent-service/tests/unit/test_graph/test_standardize.py`
- Modify: `agent-service/app/main.py` — register router

**Interfaces:**
- Consumes: `app.db.postgres.get_pool`, `app.db.neo4j.session`
- Produces: `POST /internal/graph/standardize-entities` → `{"postgres_updated": int, "neo4j_updated": int}`

- [ ] **Step 1: Write unit test for CANONICAL_MAP**

Create `agent-service/tests/unit/test_graph/test_standardize.py`:
```python
from app.graph.standardize import CANONICAL_MAP


def test_awsec2_in_map():
    assert CANONICAL_MAP["awsec2"] == "ec2"


def test_sdkfornet_in_map():
    assert CANONICAL_MAP["sdkfornet"] == "sdk"


def test_awsjavasdk_in_map():
    assert CANONICAL_MAP["awsjavasdk"] == "sdk"


def test_canonical_values_are_lowercase():
    for old, new in CANONICAL_MAP.items():
        assert new == new.lower(), f"{old} → {new} is not lowercase"


def test_no_self_mapping():
    # No entry should map a name to itself (that would be a no-op)
    for old, new in CANONICAL_MAP.items():
        assert old != new, f"{old} maps to itself"
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
pytest tests/unit/test_graph/test_standardize.py -v
```
Expected: `ERROR` — module not found.

- [ ] **Step 3: Implement `standardize.py`**

Create `agent-service/app/graph/standardize.py`:
```python
"""One-shot idempotent migration: standardize service names in Postgres + Neo4j."""

import logging

from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session
from app.db.postgres import get_pool

logger = logging.getLogger(__name__)
router = APIRouter()

# Old name → canonical name. All values must be lowercase.
CANONICAL_MAP: dict[str, str] = {
    "awsec2": "ec2",
    "sdkfornet": "sdk",
    "awsjavasdk": "sdk",
    "aws-sdk-php": "sdk",
    "awssdkforphp": "sdk",
    "embedded-csdk": "sdk",
    "freertos": "sdk",
    "code-library": "sdk",
    "appstudio": "sdk",
    "aws-sdk-go": "sdk",
    "aws-sdk-pandas": "sdk",
}


@router.post("/internal/graph/standardize-entities", status_code=202)
async def standardize_entities() -> dict:
    """Batch-update service names in Postgres and Neo4j to canonical form.

    Idempotent: safe to call multiple times.
    """
    pool = await get_pool()
    postgres_updated = 0
    neo4j_updated = 0

    for old_name, canonical in CANONICAL_MAP.items():
        # Postgres
        result = await pool.execute(
            "UPDATE app.documents SET service = $1 WHERE service = $2",
            canonical,
            old_name,
        )
        # result is e.g. "UPDATE 733" — parse the count
        try:
            count = int(result.split()[-1])
            postgres_updated += count
        except (ValueError, IndexError):
            pass

        # Neo4j
        async with neo4j_session() as s:
            cypher_result = await s.run(
                "MATCH (d:Document {service: $old}) SET d.service = $new RETURN count(d) AS cnt",
                old=old_name,
                new=canonical,
            )
            data = await cypher_result.data()
            if data:
                neo4j_updated += data[0].get("cnt", 0)

        if postgres_updated or neo4j_updated:
            logger.info("Standardized %s → %s", old_name, canonical)

    return {"postgres_updated": postgres_updated, "neo4j_updated": neo4j_updated}
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
pytest tests/unit/test_graph/test_standardize.py -v
```
Expected: 5 passed.

- [ ] **Step 5: Register router in `main.py`**

In `agent-service/app/main.py`, add:
```python
from app.graph.standardize import router as standardize_router
```
And in the app setup section:
```python
app.include_router(standardize_router)
```

- [ ] **Step 6: Smoke test (Python service must be running)**

Restart Python service (uvicorn picks up --reload), then:
```bash
curl -s -X POST http://localhost:8001/internal/graph/standardize-entities | python3 -m json.tool
```
Expected (values will vary):
```json
{"postgres_updated": 1842, "neo4j_updated": 1786}
```

- [ ] **Step 7: Verify in DB**

```bash
export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock
docker exec $(docker ps -q --filter name=postgres) psql -U postgres -c \
  "SELECT count(*) FROM app.documents WHERE service = 'awsec2'"
```
Expected: `0`

```bash
docker exec $(docker ps -q --filter name=postgres) psql -U postgres -c \
  "SELECT service, count(*) FROM app.documents WHERE service IN ('ec2','sdk') GROUP BY service"
```
Expected: `ec2` and `sdk` both have counts > 0.

- [ ] **Step 8: Commit**

```bash
git add agent-service/app/graph/standardize.py agent-service/tests/unit/test_graph/test_standardize.py agent-service/app/main.py
git commit -m "feat(entities): add standardize-entities migration endpoint"
```

---

### Task 3: Java `ServiceCategory.java` — add SDK + fallback mappings

**Files:**
- Modify: `api-service/src/main/java/com/awsdocs/domain/model/ServiceCategory.java`

**Interfaces:**
- Produces: `ServiceCategory.categoryFor("sdk")` → `"SDK"`, `ServiceCategory.categoryFor("awsec2")` → `"Compute"`

- [ ] **Step 1: Add entries to `SERVICE_TO_CATEGORY`**

In `ServiceCategory.java`, find `Map.ofEntries(` and add:
```java
      // SDK category (for SDK docs grouped separately)
      Map.entry("sdk", "SDK"),
      // Fallback aliases — handle data not yet migrated
      Map.entry("awsec2", "Compute"),
      Map.entry("sdkfornet", "SDK"),
      Map.entry("awsjavasdk", "SDK"),
      Map.entry("aws-sdk-php", "SDK"),
      Map.entry("awssdkforphp", "SDK"),
      Map.entry("embedded-csdk", "SDK"),
      Map.entry("freertos", "SDK"),
      Map.entry("code-library", "SDK"),
```

- [ ] **Step 2: Compile and verify**

```bash
cd api-service && DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn -q compile 2>&1 | tail -3
```
Expected: no output (clean compile).

- [ ] **Step 3: Run tests**

```bash
DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn test 2>&1 | grep -E "Tests run:|BUILD"
```
Expected: `BUILD SUCCESS`, no failures.

- [ ] **Step 4: Verify SDK category appears in clusters endpoint**

Restart Java service, then:
```bash
curl -s http://localhost:8083/v1/graph/clusters | python3 -c "
import sys, json
d = json.load(sys.stdin)
labels = [c['label'] for c in d['clusters']]
print('Labels:', labels)
print('SDK present:', 'SDK' in labels)
"
```
Expected: `SDK present: True`

- [ ] **Step 5: Commit**

```bash
git add api-service/src/main/java/com/awsdocs/domain/model/ServiceCategory.java
git commit -m "feat(entities): add SDK category + fallback aliases to ServiceCategory"
```

---

### Task 4: Frontend — add SDK to categories + galaxy

**Files:**
- Modify: `web/lib/categories.ts` — add `sdk` mappings + `SDK` color

**Interfaces:**
- Produces: `categoryFor("sdk")` → `"SDK"`, `categoryColor("SDK")` → `"#78909c"`

- [ ] **Step 1: Add SDK to `SERVICE_TO_CATEGORY`**

In `web/lib/categories.ts`, find the `// DevOps` section and add after it:
```typescript
  // SDK
  sdk: "SDK",
  sdkfornet: "SDK",
  awsjavasdk: "SDK",
  "aws-sdk-php": "SDK",
  awssdkforphp: "SDK",
  "embedded-csdk": "SDK",
  freertos: "SDK",
  "code-library": "SDK",
  appstudio: "SDK",
```

- [ ] **Step 2: Add SDK color to `CATEGORY_COLORS`**

In `web/lib/categories.ts`, find `CATEGORY_COLORS` and add:
```typescript
  SDK: "#78909c",
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -5
```
Expected: no output (clean).

- [ ] **Step 4: Run tests**

```bash
npm test 2>&1 | tail -6
```
Expected: all tests pass (no new test needed — `categoryFor` is a pure lookup, covered by TypeScript type safety).

- [ ] **Step 5: Check galaxy visually**

Ensure Java service is running (restarted after Task 3). Open http://localhost:3000/galaxy in browser.
Expected: **10th planet "SDK"** visible in the galaxy (grey color).

- [ ] **Step 6: Commit**

```bash
git add web/lib/categories.ts
git commit -m "feat(entities): add SDK category to frontend galaxy (grey planet)"
```

---

## Validation Checklist

- [ ] `_normalize_service("awsec2")` → `"ec2"` (Task 1 test)
- [ ] `_normalize_service("sdkfornet")` → `"sdk"` (Task 1 test)
- [ ] `POST /internal/graph/standardize-entities` → `postgres_updated > 0` (Task 2 smoke)
- [ ] `SELECT count(*) FROM app.documents WHERE service = 'awsec2'` → `0` (Task 2 verify)
- [ ] `SELECT count(*) FROM app.documents WHERE service = 'sdk'` → `> 700` (Task 2 verify)
- [ ] `GET /v1/graph/clusters` includes `SDK` label (Task 3 verify)
- [ ] Galaxy shows 10 category planets including grey SDK (Task 4 visual)
