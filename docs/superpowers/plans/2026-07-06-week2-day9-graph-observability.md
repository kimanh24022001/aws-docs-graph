# Week 2 Day 9 — Graph Atlas + Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Graph atlas renders ≥200 nodes with color-by-service. CloudWatch dashboards show query rate, latency, daily LLM cost. SNS alarms wired.

**Architecture:** Java serves graph endpoints reading from Neo4j. Frontend uses react-force-graph-2d. CloudWatch EMF structured logs carry metrics. Terraform provisions dashboards + alarms.

**Tech Stack:** Java 21 + neo4j-java-driver | Next.js 15 + react-force-graph-2d | Python + aws-embedded-metrics | Terraform (CloudWatch, SNS)

---

## File Structure

```
api-service/src/main/java/com/awsdocs/
├── adapter/in/rest/GraphController.java
├── adapter/out/graph/Neo4jGraphClient.java
└── application/
    ├── port/in/GraphUseCase.java
    ├── port/out/GraphRepository.java
    └── service/GraphService.java

agent-service/app/
└── metrics.py              CloudWatch EMF helper

web/app/
├── graph/page.tsx          (update from stub to real)
└── graph/[id]/page.tsx     (update from stub to real)

infra/envs/prod/
├── dashboards.tf           CloudWatch dashboards
└── alarms.tf               SNS alarms
```

---

### Task 1: Java graph endpoints

- [ ] **Step 1: Create GraphRepository port**

Create `api-service/src/main/java/com/awsdocs/application/port/out/GraphRepository.java`:
```java
package com.awsdocs.application.port.out;

import java.util.List;
import java.util.Map;

public interface GraphRepository {
  List<Map<String, Object>> getOverview(int limit);
  List<Map<String, Object>> getNeighbors(String documentId, int hops, int limit);
  Map<String, Object> getDocument(String documentId);
  List<Map<String, Object>> search(String query, int limit);
}
```

- [ ] **Step 2: Create Neo4jGraphClient**

Create `api-service/src/main/java/com/awsdocs/adapter/out/graph/Neo4jGraphClient.java`:
```java
package com.awsdocs.adapter.out.graph;

import com.awsdocs.application.port.out.GraphRepository;
import java.util.List;
import java.util.Map;
import org.neo4j.driver.Driver;
import org.neo4j.driver.Session;
import org.springframework.stereotype.Component;

@Component
public class Neo4jGraphClient implements GraphRepository {

  private final Driver driver;

  public Neo4jGraphClient(Driver driver) {
    this.driver = driver;
  }

  @Override
  public List<Map<String, Object>> getOverview(int limit) {
    try (Session session = driver.session()) {
      return session.run(
              """
              MATCH (d:Document)
              WHERE NOT d.placeholder = true
              WITH d, size([(d)-[]-() | 1]) AS degree
              ORDER BY degree DESC
              LIMIT $limit
              OPTIONAL MATCH (d)-[r]->(neighbor:Document)
              WHERE NOT neighbor.placeholder = true
              RETURN d.id AS id, d.url AS url, d.title AS title,
                     d.service AS service, degree,
                     collect({id: neighbor.id, type: type(r)})[0..5] AS edges
              """,
              Map.of("limit", limit))
          .list(r -> Map.of(
              "id", r.get("id").asString(""),
              "url", r.get("url").asString(""),
              "title", r.get("title").asString(""),
              "service", r.get("service").asString(""),
              "degree", r.get("degree").asInt(0),
              "edges", r.get("edges").asList()));
    }
  }

  @Override
  public List<Map<String, Object>> getNeighbors(String documentId, int hops, int limit) {
    try (Session session = driver.session()) {
      return session.run(
              """
              MATCH (src:Document {id: $id})-[r*1..$hops]-(neighbor:Document)
              WHERE NOT neighbor.placeholder = true AND neighbor.id <> $id
              RETURN DISTINCT neighbor.id AS id, neighbor.url AS url,
                     neighbor.title AS title, neighbor.service AS service
              LIMIT $limit
              """,
              Map.of("id", documentId, "hops", hops, "limit", limit))
          .list(r -> Map.of(
              "id", r.get("id").asString(""),
              "url", r.get("url").asString(""),
              "title", r.get("title").asString(""),
              "service", r.get("service").asString("")));
    }
  }

  @Override
  public Map<String, Object> getDocument(String documentId) {
    try (Session session = driver.session()) {
      var result = session.run(
          "MATCH (d:Document {id: $id}) RETURN d.id AS id, d.url AS url, d.title AS title, d.service AS service, d.word_count AS wordCount",
          Map.of("id", documentId));
      if (!result.hasNext()) return Map.of();
      var r = result.next();
      return Map.of(
          "id", r.get("id").asString(""),
          "url", r.get("url").asString(""),
          "title", r.get("title").asString(""),
          "service", r.get("service").asString(""),
          "wordCount", r.get("wordCount").asInt(0));
    }
  }

  @Override
  public List<Map<String, Object>> search(String query, int limit) {
    try (Session session = driver.session()) {
      return session.run(
              """
              MATCH (d:Document)
              WHERE toLower(d.title) CONTAINS toLower($query)
                 OR toLower(d.url) CONTAINS toLower($query)
              RETURN d.id AS id, d.url AS url, d.title AS title, d.service AS service
              LIMIT $limit
              """,
              Map.of("query", query, "limit", limit))
          .list(r -> Map.of(
              "id", r.get("id").asString(""),
              "url", r.get("url").asString(""),
              "title", r.get("title").asString(""),
              "service", r.get("service").asString("")));
    }
  }
}
```

- [ ] **Step 3: Create GraphController**

Create `api-service/src/main/java/com/awsdocs/adapter/in/rest/GraphController.java`:
```java
package com.awsdocs.adapter.in.rest;

import com.awsdocs.application.port.out.GraphRepository;
import java.util.List;
import java.util.Map;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/graph")
public class GraphController {

  private final GraphRepository graphRepository;

  public GraphController(GraphRepository graphRepository) {
    this.graphRepository = graphRepository;
  }

  @GetMapping("/overview")
  @Cacheable(value = "graph-overview", key = "'overview'")
  public Map<String, Object> overview() {
    var nodes = graphRepository.getOverview(2000);
    var edges = nodes.stream()
        .flatMap(n -> ((List<Map<String, Object>>) n.getOrDefault("edges", List.of())).stream()
            .map(e -> Map.of("source", n.get("id"), "target", e.get("id"), "type", e.get("type"))))
        .toList();
    return Map.of("nodes", nodes, "edges", edges);
  }

  @GetMapping("/documents/{id}")
  public Map<String, Object> document(@PathVariable String id) {
    return graphRepository.getDocument(id);
  }

  @GetMapping("/documents/{id}/neighbors")
  public List<Map<String, Object>> neighbors(
      @PathVariable String id, @RequestParam(defaultValue = "1") int hops) {
    return graphRepository.getNeighbors(id, Math.min(hops, 2), 200);
  }

  @GetMapping("/search")
  public List<Map<String, Object>> search(@RequestParam String q) {
    return graphRepository.search(q, 20);
  }
}
```

Add to `application.properties`:
```properties
spring.neo4j.uri=${NEO4J_URI:bolt://localhost:7687}
spring.neo4j.authentication.username=${NEO4J_USERNAME:neo4j}
spring.neo4j.authentication.password=${NEO4J_PASSWORD:devpassword}
spring.cache.type=caffeine
spring.cache.caffeine.spec=expireAfterWrite=24h,maximumSize=10
```

Add to `pom.xml` dependencies:
```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-cache</artifactId>
</dependency>
<dependency>
  <groupId>com.github.ben-manes.caffeine</groupId>
  <artifactId>caffeine</artifactId>
</dependency>
<dependency>
  <groupId>org.neo4j.driver</groupId>
  <artifactId>neo4j-java-driver</artifactId>
  <version>5.20.0</version>
</dependency>
```

- [ ] **Step 4: Commit**

```bash
git add api-service/ && git commit -m "feat: add graph endpoints (overview, document, neighbors, search)"
```

---

### Task 2: Frontend graph pages

- [ ] **Step 1: Update /graph page**

Update `web/app/graph/page.tsx` (replace stub with real):
```tsx
'use client';

import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { fetchGraphOverview } from '@/lib/api';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const SERVICE_COLORS: Record<string, string> = {
  S3: '#FF9900', EC2: '#FF6B35', IAM: '#DD344C', Lambda: '#FF9900',
  RDS: '#3B48CC', DynamoDB: '#3B48CC', CloudWatch: '#E7157B',
  default: '#808080',
};

function getColor(service: string): string {
  return SERVICE_COLORS[service] ?? SERVICE_COLORS.default;
}

export default function GraphPage() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['graph-overview'],
    queryFn: fetchGraphOverview,
  });

  if (isLoading) return <div className="p-8">Loading graph...</div>;

  const graphData = {
    nodes: (data?.nodes ?? []).map((n: any) => ({
      id: n.id, label: n.title ?? n.url, color: getColor(n.service ?? ''),
      service: n.service,
    })),
    links: (data?.edges ?? []).map((e: any) => ({ source: e.source, target: e.target })),
  };

  return (
    <div className="w-full h-screen">
      <ForceGraph2D
        graphData={graphData}
        nodeColor={(n: any) => n.color}
        nodeLabel={(n: any) => n.label}
        onNodeClick={(n: any) => router.push(`/graph/${n.id}`)}
        width={typeof window !== 'undefined' ? window.innerWidth : 1200}
        height={typeof window !== 'undefined' ? window.innerHeight : 800}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update /graph/[id] page**

Update `web/app/graph/[id]/page.tsx`:
```tsx
'use client';

import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { fetchDocumentNeighbors, fetchDocument } from '@/lib/api';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

export default function GraphNodePage() {
  const { id } = useParams<{ id: string }>();
  const { data: doc } = useQuery({ queryKey: ['doc', id], queryFn: () => fetchDocument(id) });
  const { data: neighbors } = useQuery({ queryKey: ['neighbors', id], queryFn: () => fetchDocumentNeighbors(id) });

  const graphData = {
    nodes: [
      { id, label: doc?.title ?? id, color: '#FF9900' },
      ...(neighbors ?? []).map((n: any) => ({ id: n.id, label: n.title ?? n.url, color: '#808080' })),
    ],
    links: (neighbors ?? []).map((n: any) => ({ source: id, target: n.id })),
  };

  return (
    <div className="flex h-screen">
      <div className="w-64 p-4 border-r overflow-y-auto">
        <h2 className="font-bold text-lg mb-2">{doc?.title ?? 'Document'}</h2>
        <p className="text-sm text-gray-600 mb-1">{doc?.service}</p>
        <a href={doc?.url} target="_blank" rel="noopener noreferrer"
           className="text-blue-600 text-sm break-all">{doc?.url}</a>
        <p className="text-sm mt-2">{doc?.wordCount} words</p>
        <h3 className="font-semibold mt-4 mb-1">Neighbors ({neighbors?.length ?? 0})</h3>
        {(neighbors ?? []).map((n: any) => (
          <a key={n.id} href={`/graph/${n.id}`} className="block text-sm text-blue-600 mb-1 truncate">{n.title ?? n.url}</a>
        ))}
      </div>
      <div className="flex-1">
        <ForceGraph2D graphData={graphData} nodeLabel={(n: any) => n.label}
          width={typeof window !== 'undefined' ? window.innerWidth - 256 : 900}
          height={typeof window !== 'undefined' ? window.innerHeight : 800} />
      </div>
    </div>
  );
}
```

Add to `lib/api.ts`:
```typescript
export async function fetchGraphOverview() {
  const res = await apiClient.get('/v1/graph/overview');
  return res.data;
}
export async function fetchDocument(id: string) {
  const res = await apiClient.get(`/v1/graph/documents/${id}`);
  return res.data;
}
export async function fetchDocumentNeighbors(id: string) {
  const res = await apiClient.get(`/v1/graph/documents/${id}/neighbors`);
  return res.data;
}
```

- [ ] **Step 3: Commit**

```bash
git add web/ && git commit -m "feat: wire graph atlas pages with react-force-graph-2d"
```

---

### Task 3: CloudWatch EMF metrics (Python)

- [ ] **Step 1: Create metrics helper**

Create `agent-service/app/metrics.py`:
```python
import json
import time
from contextlib import contextmanager


def emit_metric(metric_name: str, value: float, unit: str, dimensions: dict) -> None:
    """Emit a CloudWatch EMF metric via structured stdout log."""
    payload = {
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": "AwsDocsGraph",
                    "Dimensions": [list(dimensions.keys())],
                    "Metrics": [{"Name": metric_name, "Unit": unit}],
                }
            ],
        },
        metric_name: value,
        **dimensions,
    }
    print(json.dumps(payload), flush=True)


@contextmanager
def timed_metric(metric_name: str, dimensions: dict):
    """Context manager that emits a duration metric in milliseconds."""
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        emit_metric(metric_name, elapsed_ms, "Milliseconds", dimensions)
```

Add metrics calls in `agent-service/app/agents/run.py` — wrap the graph invoke:
```python
from app.metrics import emit_metric, timed_metric

# Inside run_agent(), wrap the graph.ainvoke call:
with timed_metric("query_duration_ms", {"question_type": initial_state["question_type"]}):
    result = await graph.ainvoke(initial_state)

emit_metric("query_count", 1, "Count", {"status": "succeeded" if not result["degraded"] else "degraded"})
emit_metric("llm_cost_usd", result["total_cost_usd"], "None", {"source": "agent"})
```

- [ ] **Step 2: Commit**

```bash
git add agent-service/app/metrics.py agent-service/app/agents/run.py
git commit -m "feat: add CloudWatch EMF metrics to agent-service"
```

---

### Task 4: Terraform CloudWatch dashboards + alarms

- [ ] **Step 1: Create `infra/envs/prod/alarms.tf`**

```hcl
locals {
  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "llm_cost_high" {
  alarm_name          = "${local.name_prefix}-llm-cost-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "llm_cost_usd"
  namespace           = "AwsDocsGraph"
  period              = 86400
  statistic           = "Sum"
  threshold           = 1.0
  alarm_description   = "Daily LLM cost > $1"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "query_failure_rate" {
  alarm_name          = "${local.name_prefix}-query-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "query_count"
  namespace           = "AwsDocsGraph"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  dimensions          = { status = "failed" }
  alarm_description   = "Query failure rate high"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "lambda_p99_high" {
  alarm_name                = "${local.name_prefix}-lambda-p99"
  comparison_operator       = "GreaterThanThreshold"
  evaluation_periods        = 2
  extended_statistic        = "p99"
  metric_name               = "Duration"
  namespace                 = "AWS/Lambda"
  period                    = 300
  threshold                 = 25000
  dimensions                = { FunctionName = "${local.name_prefix}-agent-service" }
  alarm_description         = "Lambda p99 > 25s"
  alarm_actions             = local.alarm_actions
}
```

- [ ] **Step 2: Create `infra/envs/prod/dashboards.tf`**

```hcl
resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = "${local.name_prefix}-operations"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6,
        properties = {
          title  = "Query Rate"
          metrics = [["AwsDocsGraph", "query_count", "status", "succeeded"],
                     ["...", "status", "failed"]]
          period = 300, stat = "Sum", view = "timeSeries"
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6,
        properties = {
          title  = "Query Duration p50/p99"
          metrics = [["AwsDocsGraph", "query_duration_ms"]]
          period = 300, stat = "p50", view = "timeSeries"
        }
      }
    ]
  })
}

resource "aws_cloudwatch_dashboard" "cost" {
  dashboard_name = "${local.name_prefix}-cost"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 24, height = 6,
        properties = {
          title   = "Daily LLM Cost (USD)"
          metrics = [["AwsDocsGraph", "llm_cost_usd", "source", "agent"]]
          period  = 86400, stat = "Sum", view = "timeSeries"
        }
      }
    ]
  })
}
```

- [ ] **Step 3: Apply Terraform**

```bash
cd infra/envs/prod
terraform plan -out=tfplan
terraform apply tfplan
```

Expected: dashboards + alarms created.

- [ ] **Step 4: Commit**

```bash
cd ../../.. && git add infra/envs/prod/alarms.tf infra/envs/prod/dashboards.tf
git commit -m "feat: add CloudWatch dashboards and SNS alarms via Terraform"
```

---

### Day 9 Done

Gate checks:
- [ ] `/graph` renders force-directed nodes with color-by-service
- [ ] Click node → `/graph/[id]` shows neighbors
- [ ] `aws cloudwatch list-dashboards` shows `aws-docs-graph-operations` and `aws-docs-graph-cost`
- [ ] `aws cloudwatch describe-alarms --alarm-name-prefix aws-docs-graph` shows 3 alarms
