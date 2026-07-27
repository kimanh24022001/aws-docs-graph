# Entity Standardization — Design

**Status:** Approved, ready for implementation planning
**Date:** 2026-07-27
**Author:** Brainstorm session (user + Claude)
**Project:** aws-docs-graph

---

## 1. Goal

Standardize AWS service entity names across Postgres and Neo4j so that:
- Duplicate service names are merged to a canonical form (`awsec2` → `ec2`)
- SDK documentation is grouped under a new `sdk` category rather than polluting AWS service categories
- New ingestion produces canonical names automatically

---

## 2. Scope

**In scope:**
- Python `_normalize_service()` expanded with new aliases
- New `POST /internal/graph/standardize-entities` batch migration endpoint
- Java `ServiceCategory.java` updated with new mappings + new `sdk` category
- `web/lib/categories.ts` updated with `sdk` category + color

**Out of scope:**
- Re-ingesting all docs (migration handles existing data)
- Merging Neo4j Document nodes at the graph level (SET service property is sufficient)
- Adding `sdk` relationships to the galaxy evidence panel

---

## 3. Canonical Mapping

### 3.1 Service name normalization

| Old name(s) | Canonical | Category |
|---|---|---|
| `awsec2`, `amazonec2` | `ec2` | Compute |
| `amazons3` | `s3` | Storage |
| `amazonecs` | `ecs` | Compute |
| `amazonrds` | `rds` | Database |
| `amazondynamodb` | `dynamodb` | Database |
| `amazonsns` | `sns` | Integration |
| `awssimplequeueservice` | `sqs` | Integration |
| `amazoncloudwatch` | `cloudwatch` | DevOps |
| `awscloudformation` | `cloudformation` | DevOps |
| `amazonroute53` | `route53` | Networking |
| `amazonelasticache` | `elasticache` | Database |
| `amazonredshift` | `redshift` | Analytics |
| `amazonkinesis` | `kinesis` | Analytics |
| `amazoncognito` | `cognito` | Security |
| `awssecretsmanager` | `secretsmanager` | Security |
| `amazonapigateway` | `apigateway` | Networking |

### 3.2 SDK → canonical `sdk`

| Old name(s) | Canonical |
|---|---|
| `sdkfornet`, `awsjavasdk`, `sdk-for-ruby`, `aws-sdk-php`, `awssdkforphp` | `sdk` |
| `powershell`, `cli` | `cli` (already canonical) |
| `embedded-csdk`, `freertos`, `code-library` | `sdk` |

---

## 4. Implementation

### 4.1 Python — `_normalize_service()` in `agent-service/app/ingest/page.py`

Add to `_SERVICE_ALIASES`:
```python
"awsec2": "ec2",
"sdkfornet": "sdk",
"awsjavasdk": "sdk",
"aws-sdk-php": "sdk",
"awssdkforphp": "sdk",
"embedded-csdk": "sdk",
"freertos": "sdk",
"code-library": "sdk",
```

The existing entries (`amazonec2 → ec2`, `amazons3 → s3`, etc.) already handle those cases.

### 4.2 Python — new migration endpoint

New file: `agent-service/app/graph/standardize.py`

```
POST /internal/graph/standardize-entities
  No params required.
  Idempotent — safe to re-run.

Response:
{
  "postgres_updated": 1842,
  "neo4j_updated": 1786
}
```

Mapping applied:
```python
CANONICAL_MAP = {
    "awsec2": "ec2",
    "sdkfornet": "sdk",
    "awsjavasdk": "sdk",
    "aws-sdk-php": "sdk",
    "awssdkforphp": "sdk",
    "embedded-csdk": "sdk",
    "freertos": "sdk",
    "code-library": "sdk",
    # SDK sub-variants
    "appstudio": "sdk",
    "aws-sdk-go": "sdk",
    "aws-sdk-pandas": "sdk",
}
```

Postgres: `UPDATE app.documents SET service = $canonical WHERE service = $old`

Neo4j: `MATCH (d:Document {service: $old}) SET d.service = $canonical`

### 4.3 Java — `ServiceCategory.java`

Add `sdk` category:
```java
Map.entry("sdk", "SDK"),
Map.entry("awsec2", "Compute"),    // fallback for data not yet migrated
Map.entry("sdkfornet", "SDK"),     // fallback
Map.entry("awsjavasdk", "SDK"),    // fallback
```

### 4.4 Frontend — `web/lib/categories.ts`

Add SDK mappings:
```typescript
sdk: "SDK",
sdkfornet: "SDK",
awsjavasdk: "SDK",
"aws-sdk-php": "SDK",
"code-library": "SDK",
```

Add SDK color to `CATEGORY_COLORS`:
```typescript
SDK: "#78909c",  // grey — SDK is tooling, not an AWS service
```

---

## 5. Validation criteria

1. `POST /internal/graph/standardize-entities` → `postgres_updated > 0`, `neo4j_updated > 0`
2. After migration: `SELECT count(*) FROM app.documents WHERE service = 'awsec2'` → `0`
3. After migration: `SELECT count(*) FROM app.documents WHERE service = 'sdk'` → `> 700`
4. `_normalize_service("awsec2")` → `"ec2"`
5. `_normalize_service("sdkfornet")` → `"sdk"`
6. Galaxy Level 0 shows **SDK** as a 10th category planet
7. Re-ingest one EC2 doc URL → `service = 'ec2'` in DB
