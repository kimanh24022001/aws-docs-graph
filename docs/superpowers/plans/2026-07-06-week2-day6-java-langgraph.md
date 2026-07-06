# Week 2 Day 6 — Java api-service Skeleton + LangGraph Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Java api-service with hexagonal architecture and wire the LangGraph 5-node agent pipeline with unit tests passing.

**Architecture:** Java Spring Boot 3 on Lambda with hexagonal package structure (domain/application/adapter). Python LangGraph linear graph: plan→mcp_search→graph_traverse→mcp_read→synthesize→format. Both are independent and can be scaffolded in parallel.

**Tech Stack:** Java 21, Spring Boot 3, Maven, aws-serverless-java-container, ArchUnit, JUnit 5, Mockito, Testcontainers, WireMock | Python 3.12, LangGraph, langchain-anthropic, httpx, pytest, respx

---

## File Structure

### Java api-service
```
api-service/
├── pom.xml
└── src/
    ├── main/java/com/awsdocs/
    │   ├── domain/
    │   │   ├── model/Query.java
    │   │   ├── model/Document.java
    │   │   └── model/User.java
    │   ├── application/
    │   │   ├── port/in/QueryUseCase.java
    │   │   ├── port/out/QueryRepository.java
    │   │   └── service/QueryService.java
    │   ├── adapter/
    │   │   ├── in/rest/HealthzController.java
    │   │   ├── in/rest/MeController.java
    │   │   └── in/rest/dto/UserResponse.java
    │   └── infrastructure/
    │       ├── LambdaHandler.java
    │       └── config/SpringConfig.java
    └── test/java/com/awsdocs/
        ├── architecture/HexagonalArchTest.java
        └── adapter/in/rest/HealthzControllerTest.java
```

### Python agents
```
agent-service/app/agents/
├── __init__.py
├── graph.py
├── state.py
├── prompts/
│   ├── plan.txt
│   └── synthesize.txt
└── nodes/
    ├── __init__.py
    ├── plan.py
    ├── mcp_search.py
    ├── graph_traverse.py
    ├── mcp_read.py
    ├── synthesize.py
    └── format.py
agent-service/tests/unit/test_agents/
├── __init__.py
├── test_plan_node.py
├── test_mcp_search_node.py
├── test_graph_traverse_node.py
├── test_mcp_read_node.py
├── test_synthesize_node.py
└── test_format_node.py
```

---

### Task 1: Java pom.xml + project scaffold

**Files:**
- Create: `api-service/pom.xml`
- Create: `api-service/src/main/java/com/awsdocs/infrastructure/LambdaHandler.java`
- Create: `api-service/src/main/resources/application.properties`

- [ ] **Step 1: Create `api-service/pom.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.awsdocs</groupId>
  <artifactId>api-service</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <packaging>jar</packaging>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.0</version>
    <relativePath/>
  </parent>

  <properties>
    <java.version>21</java.version>
    <aws-serverless-java-container.version>2.0.0</aws-serverless-java-container.version>
    <archunit.version>1.3.0</archunit.version>
    <testcontainers.version>1.19.8</testcontainers.version>
    <wiremock.version>3.6.0</wiremock.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-jdbc</artifactId>
    </dependency>
    <dependency>
      <groupId>org.postgresql</groupId>
      <artifactId>postgresql</artifactId>
    </dependency>
    <dependency>
      <groupId>com.amazonaws.serverless</groupId>
      <artifactId>aws-serverless-java-container-springboot3</artifactId>
      <version>${aws-serverless-java-container.version}</version>
    </dependency>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>auth</artifactId>
      <version>2.25.0</version>
    </dependency>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>http-client-spi</artifactId>
      <version>2.25.0</version>
    </dependency>

    <!-- Test -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>com.tngtech.archunit</groupId>
      <artifactId>archunit-junit5</artifactId>
      <version>${archunit.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.testcontainers</groupId>
      <artifactId>postgresql</artifactId>
      <version>${testcontainers.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.wiremock</groupId>
      <artifactId>wiremock-standalone</artifactId>
      <version>${wiremock.version}</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
      <plugin>
        <groupId>com.diffplug.spotless</groupId>
        <artifactId>spotless-maven-plugin</artifactId>
        <version>2.43.0</version>
        <configuration>
          <java>
            <googleJavaFormat>
              <version>1.22.0</version>
            </googleJavaFormat>
          </java>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
```

- [ ] **Step 2: Create domain model classes**

Create `api-service/src/main/java/com/awsdocs/domain/model/User.java`:
```java
package com.awsdocs.domain.model;

public record User(String id, String email) {}
```

Create `api-service/src/main/java/com/awsdocs/domain/model/Query.java`:
```java
package com.awsdocs.domain.model;

import java.time.Instant;
import java.util.UUID;

public record Query(
    UUID id,
    String userId,
    String orgId,
    String question,
    String status,
    String answer,
    Instant createdAt) {}
```

Create `api-service/src/main/java/com/awsdocs/domain/model/Document.java`:
```java
package com.awsdocs.domain.model;

import java.util.UUID;

public record Document(UUID id, String url, String title, String service) {}
```

- [ ] **Step 3: Create Lambda handler**

Create `api-service/src/main/java/com/awsdocs/infrastructure/LambdaHandler.java`:
```java
package com.awsdocs.infrastructure;

import com.amazonaws.serverless.proxy.model.AwsProxyRequest;
import com.amazonaws.serverless.proxy.model.AwsProxyResponse;
import com.amazonaws.serverless.proxy.spring.SpringBootLambdaContainerHandler;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.awsdocs.infrastructure.config.SpringConfig;

public class LambdaHandler implements RequestHandler<AwsProxyRequest, AwsProxyResponse> {

  private static final SpringBootLambdaContainerHandler<AwsProxyRequest, AwsProxyResponse> handler;

  static {
    try {
      handler = SpringBootLambdaContainerHandler.getAwsProxyHandler(SpringConfig.class);
    } catch (Exception e) {
      throw new RuntimeException("Failed to initialize Spring handler", e);
    }
  }

  @Override
  public AwsProxyResponse handleRequest(AwsProxyRequest input, Context context) {
    return handler.proxy(input, context);
  }
}
```

Create `api-service/src/main/java/com/awsdocs/infrastructure/config/SpringConfig.java`:
```java
package com.awsdocs.infrastructure.config;

import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = "com.awsdocs")
public class SpringConfig {}
```

Create `api-service/src/main/resources/application.properties`:
```properties
spring.datasource.url=${DATABASE_URL:jdbc:postgresql://localhost:5432/postgres}
spring.datasource.username=${DATABASE_USERNAME:postgres}
spring.datasource.password=${DATABASE_PASSWORD:postgres}
```

- [ ] **Step 4: Create healthz + me controllers**

Create `api-service/src/main/java/com/awsdocs/adapter/in/rest/HealthzController.java`:
```java
package com.awsdocs.adapter.in.rest;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthzController {

  @GetMapping("/v1/healthz")
  public Map<String, String> healthz() {
    return Map.of("status", "ok");
  }
}
```

Create `api-service/src/main/java/com/awsdocs/adapter/in/rest/dto/UserResponse.java`:
```java
package com.awsdocs.adapter.in.rest.dto;

public record UserResponse(String userId, String email) {}
```

Create `api-service/src/main/java/com/awsdocs/adapter/in/rest/MeController.java`:
```java
package com.awsdocs.adapter.in.rest;

import com.awsdocs.adapter.in.rest.dto.UserResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MeController {

  @GetMapping("/v1/me")
  public UserResponse me(HttpServletRequest request) {
    // Lambda Authorizer injects userId and email into request context headers
    String userId = request.getHeader("X-User-Id");
    String email = request.getHeader("X-User-Email");
    return new UserResponse(userId, email);
  }
}
```

- [ ] **Step 5: Write ArchUnit test**

Create `api-service/src/test/java/com/awsdocs/architecture/HexagonalArchTest.java`:
```java
package com.awsdocs.architecture;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition;
import org.junit.jupiter.api.Test;

class HexagonalArchTest {

  private final var classes = new ClassFileImporter().importPackages("com.awsdocs");

  @Test
  void domain_should_not_depend_on_application_or_adapters() {
    ArchRule rule =
        ArchRuleDefinition.noClasses()
            .that()
            .resideInAPackage("..domain..")
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("..application..", "..adapter..", "..infrastructure..");
    rule.check(classes);
  }

  @Test
  void application_should_not_depend_on_adapters() {
    ArchRule rule =
        ArchRuleDefinition.noClasses()
            .that()
            .resideInAPackage("..application..")
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("..adapter..");
    rule.check(classes);
  }

  @Test
  void adapter_in_should_not_depend_on_adapter_out() {
    ArchRule rule =
        ArchRuleDefinition.noClasses()
            .that()
            .resideInAPackage("..adapter.in..")
            .should()
            .dependOnClassesThat()
            .resideInAPackage("..adapter.out..");
    rule.check(classes);
  }
}
```

- [ ] **Step 6: Write healthz controller test**

Create `api-service/src/test/java/com/awsdocs/adapter/in/rest/HealthzControllerTest.java`:
```java
package com.awsdocs.adapter.in.rest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(HealthzController.class)
class HealthzControllerTest {

  @Autowired MockMvc mockMvc;

  @Test
  void healthz_returns_ok() throws Exception {
    mockMvc
        .perform(get("/v1/healthz"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("ok"));
  }
}
```

- [ ] **Step 7: Run tests**

```bash
cd api-service && mvn test
```

Expected: `BUILD SUCCESS`, all tests pass including ArchUnit rules.

- [ ] **Step 8: Commit**

```bash
cd .. && git add api-service/ && git commit -m "feat: add Java api-service skeleton (hexagonal, healthz, /v1/me, ArchUnit)"
```

---

### Task 2: LangGraph agent state + graph definition

**Files:**
- Create: `agent-service/app/agents/state.py`
- Create: `agent-service/app/agents/graph.py`
- Create: `agent-service/app/agents/prompts/plan.txt`
- Create: `agent-service/app/agents/prompts/synthesize.txt`

- [ ] **Step 1: Create AgentState**

Create `agent-service/app/agents/state.py`:
```python
from typing import TypedDict


class AgentState(TypedDict):
    query_id: str
    user_id: str
    org_id: str
    question: str
    question_type: str          # "factual" | "navigation_only" | "comparison"
    keywords: list[str]
    expected_services: list[str]
    mcp_results: list[dict]     # raw MCP search results
    graph_docs: list[dict]      # docs from graph traversal
    mcp_read_docs: list[dict]   # full doc content from mcp_read
    answer: str
    citation_ranks: list[int]
    citations: list[dict]
    related_docs: list[dict]
    total_tokens: int
    total_cost_usd: float
    degraded: bool
    degraded_reason: str
    truncated: bool
    started_at: str
```

- [ ] **Step 2: Create graph definition**

Create `agent-service/app/agents/graph.py`:
```python
from langgraph.graph import END, StateGraph

from app.agents.nodes.format import format_node
from app.agents.nodes.graph_traverse import graph_traverse_node
from app.agents.nodes.mcp_read import mcp_read_node
from app.agents.nodes.mcp_search import mcp_search_node
from app.agents.nodes.plan import plan_node
from app.agents.nodes.synthesize import synthesize_node
from app.agents.state import AgentState


def build_graph():
    g = StateGraph(AgentState)

    g.add_node("plan", plan_node)
    g.add_node("mcp_search", mcp_search_node)
    g.add_node("graph_traverse", graph_traverse_node)
    g.add_node("mcp_read", mcp_read_node)
    g.add_node("synthesize", synthesize_node)
    g.add_node("format", format_node)

    g.set_entry_point("plan")
    g.add_edge("plan", "mcp_search")
    g.add_edge("mcp_search", "graph_traverse")
    g.add_edge("graph_traverse", "mcp_read")
    g.add_edge("mcp_read", "synthesize")
    g.add_edge("synthesize", "format")
    g.add_edge("format", END)

    return g.compile()


graph = build_graph()
```

- [ ] **Step 3: Create plan node**

Create `agent-service/app/agents/nodes/plan.py`:
```python
import json
import re
from datetime import UTC, datetime

import anthropic

from app.agents.state import AgentState
from app.config import settings

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


PLAN_PROMPT = """Extract search intent from this AWS question.

Return JSON only:
{
  "keywords": ["keyword1", "keyword2"],
  "expected_services": ["S3", "IAM"],
  "question_type": "factual"
}

question_type must be one of: "factual", "navigation_only", "comparison"
"""


def _extract_keywords_fallback(question: str) -> list[str]:
    words = re.findall(r"\b[A-Za-z][a-z]+(?:[A-Z][a-z]+)*\b", question)
    return list({w for w in words if len(w) > 3})[:5]


def plan_node(state: AgentState) -> AgentState:
    try:
        msg = _get_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            system=PLAN_PROMPT,
            messages=[{"role": "user", "content": state["question"]}],
        )
        data = json.loads(msg.content[0].text)
        keywords = data.get("keywords", [])
        expected_services = data.get("expected_services", [])
        question_type = data.get("question_type", "factual")
    except Exception:
        keywords = _extract_keywords_fallback(state["question"])
        expected_services = []
        question_type = "factual"

    return {
        **state,
        "keywords": keywords,
        "expected_services": expected_services,
        "question_type": question_type,
        "started_at": datetime.now(UTC).isoformat(),
        "total_tokens": 0,
        "total_cost_usd": 0.0,
        "degraded": False,
        "degraded_reason": "",
        "truncated": False,
    }
```

- [ ] **Step 4: Create mcp_search node**

Create `agent-service/app/agents/nodes/mcp_search.py`:
```python
import httpx

from app.agents.state import AgentState

MCP_ENDPOINT = "https://knowledge-mcp.global.api.aws"
MAX_RESULTS = 8


def _search_one(client: httpx.Client, keyword: str) -> list[dict]:
    try:
        resp = client.post(
            f"{MCP_ENDPOINT}/search_documentation",
            json={"query": keyword, "max_results": 4},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("results", [])
    except Exception:
        return []


def mcp_search_node(state: AgentState) -> AgentState:
    results = []
    try:
        with httpx.Client() as client:
            for kw in state["keywords"][:3]:
                results.extend(_search_one(client, kw))
        # Deduplicate by URL, keep top MAX_RESULTS
        seen = set()
        deduped = []
        for r in results:
            url = r.get("url", "")
            if url and url not in seen:
                seen.add(url)
                deduped.append(r)
        results = deduped[:MAX_RESULTS]
    except Exception:
        results = []

    degraded = len(results) == 0
    return {
        **state,
        "mcp_results": results,
        "degraded": degraded,
        "degraded_reason": "mcp_unavailable" if degraded else state.get("degraded_reason", ""),
    }
```

- [ ] **Step 5: Create graph_traverse node**

Create `agent-service/app/agents/nodes/graph_traverse.py`:
```python
from app.agents.state import AgentState
from app.db.neo4j import session as neo4j_session

TRAVERSE_QUERY = """
MATCH (d:Document)
WHERE d.url IN $urls
CALL {
  WITH d
  MATCH (d)-[r:LINKS_TO|PREV_NEXT|CO_RETURNED]-(neighbor:Document)
  RETURN neighbor, r
  LIMIT 5
}
RETURN DISTINCT neighbor.id AS id, neighbor.url AS url,
       neighbor.title AS title, neighbor.service AS service
LIMIT 10
"""


async def graph_traverse_node(state: AgentState) -> AgentState:
    urls = [r.get("url") for r in state.get("mcp_results", []) if r.get("url")]
    graph_docs = []
    try:
        async with neo4j_session() as s:
            result = await s.run(TRAVERSE_QUERY, urls=urls)
            records = await result.data()
            graph_docs = [
                {"id": r["id"], "url": r["url"], "title": r["title"], "service": r["service"]}
                for r in records
            ]
    except Exception:
        graph_docs = []
        return {
            **state,
            "graph_docs": [],
            "degraded": True,
            "degraded_reason": state.get("degraded_reason") or "graph_unavailable",
        }
    return {**state, "graph_docs": graph_docs}
```

- [ ] **Step 6: Create mcp_read node**

Create `agent-service/app/agents/nodes/mcp_read.py`:
```python
import httpx

from app.agents.state import AgentState

MCP_ENDPOINT = "https://knowledge-mcp.global.api.aws"
MAX_CHARS = 6000


def mcp_read_node(state: AgentState) -> AgentState:
    if state.get("question_type") == "navigation_only":
        return {**state, "mcp_read_docs": []}

    top_urls = [r.get("url") for r in state.get("mcp_results", [])[:2] if r.get("url")]
    docs = []
    try:
        with httpx.Client() as client:
            for url in top_urls:
                try:
                    resp = client.post(
                        f"{MCP_ENDPOINT}/read_documentation",
                        json={"url": url},
                        timeout=15,
                    )
                    resp.raise_for_status()
                    content = resp.json().get("content", "")[:MAX_CHARS]
                    docs.append({"url": url, "content": content})
                except Exception:
                    pass
    except Exception:
        pass

    return {**state, "mcp_read_docs": docs}
```

- [ ] **Step 7: Create synthesize node**

Create `agent-service/app/agents/nodes/synthesize.py`:
```python
import json

import anthropic

from app.agents.state import AgentState
from app.config import settings

_client = None
TOKEN_BUDGET = 50_000

SYSTEM_PROMPT = """You are an AWS documentation assistant. Answer the user's question using the provided documentation excerpts. Include citation numbers [1], [2] etc. when referencing sources. Be concise and accurate."""


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


def _build_context(state: AgentState) -> str:
    parts = []
    for i, doc in enumerate(state.get("mcp_read_docs", []), 1):
        parts.append(f"[{i}] {doc['url']}\n{doc['content'][:3000]}")
    for doc in state.get("mcp_results", [])[:6]:
        parts.append(f"Source: {doc.get('url', '')} — {doc.get('snippet', '')[:500]}")
    return "\n\n".join(parts)


def _navigation_fallback(state: AgentState) -> tuple[str, list[int]]:
    sources = state.get("mcp_results", []) + state.get("graph_docs", [])
    urls = [s.get("url", "") for s in sources[:5] if s.get("url")]
    answer = f"Here are the most relevant AWS documentation pages for your question:\n" + "\n".join(
        f"- {u}" for u in urls
    )
    return answer, list(range(1, len(urls) + 1))


def synthesize_node(state: AgentState) -> AgentState:
    context = _build_context(state)

    for attempt in range(2):
        try:
            msg = _get_client().messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                messages=[
                    {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {state['question']}"}
                ],
            )
            answer = msg.content[0].text
            ranks = list(range(1, len(state.get("mcp_results", [])) + 1))
            return {
                **state,
                "answer": answer,
                "citation_ranks": ranks,
                "total_tokens": state.get("total_tokens", 0) + msg.usage.input_tokens + msg.usage.output_tokens,
            }
        except Exception:
            if attempt == 1:
                answer, ranks = _navigation_fallback(state)
                return {**state, "answer": answer, "citation_ranks": ranks, "degraded": True, "degraded_reason": "synthesis_failed"}
    answer, ranks = _navigation_fallback(state)
    return {**state, "answer": answer, "citation_ranks": ranks, "degraded": True, "degraded_reason": "synthesis_failed"}
```

- [ ] **Step 8: Create format node**

Create `agent-service/app/agents/nodes/format.py`:
```python
from app.agents.state import AgentState


def format_node(state: AgentState) -> AgentState:
    mcp_results = state.get("mcp_results", [])
    ranks = state.get("citation_ranks", [])

    citations = []
    for rank in ranks:
        idx = rank - 1
        if 0 <= idx < len(mcp_results):
            r = mcp_results[idx]
            citations.append({
                "rank": rank,
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "service": r.get("service", ""),
                "snippet": r.get("snippet", ""),
                "score": r.get("score", 0.0),
                "source_kind": "mcp_search",
            })

    related_docs = [
        {
            "title": d.get("title", ""),
            "url": d.get("url", ""),
            "service": d.get("service", ""),
            "hop_count": 1,
            "edge_path": ["LINKS_TO"],
        }
        for d in state.get("graph_docs", [])
    ]

    return {**state, "citations": citations, "related_docs": related_docs}
```

- [ ] **Step 9: Add /internal/agents/run endpoint**

Add to `agent-service/app/main.py` imports and router:
```python
from app.agents.run import router as agents_router
# add: app.include_router(agents_router)
```

Create `agent-service/app/agents/run.py`:
```python
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel

from app.agents.graph import graph

router = APIRouter()


class AgentRunRequest(BaseModel):
    query_id: str
    user_id: str
    org_id: str
    question: str


@router.post("/internal/agents/run")
async def run_agent(req: AgentRunRequest):
    initial_state = {
        "query_id": req.query_id,
        "user_id": req.user_id,
        "org_id": req.org_id,
        "question": req.question,
        "keywords": [],
        "expected_services": [],
        "question_type": "factual",
        "mcp_results": [],
        "graph_docs": [],
        "mcp_read_docs": [],
        "answer": "",
        "citation_ranks": [],
        "citations": [],
        "related_docs": [],
        "total_tokens": 0,
        "total_cost_usd": 0.0,
        "degraded": False,
        "degraded_reason": "",
        "truncated": False,
        "started_at": datetime.now(UTC).isoformat(),
    }

    result = await graph.ainvoke(initial_state)

    return {
        "answer": result["answer"],
        "citations": result["citations"],
        "related_docs": result["related_docs"],
        "cost_breakdown": {"total_tokens": result["total_tokens"], "total_cost_usd": result["total_cost_usd"]},
        "agent_run_id": str(uuid.uuid4()),
        "degraded": result["degraded"],
        "degraded_reason": result["degraded_reason"],
    }
```

- [ ] **Step 10: Write unit tests for plan node**

Create `agent-service/tests/unit/test_agents/test_plan_node.py`:
```python
import pytest
from unittest.mock import MagicMock, patch
from app.agents.nodes.plan import plan_node, _extract_keywords_fallback


def make_state(**kwargs):
    return {
        "query_id": "q1", "user_id": "u1", "org_id": "o1",
        "question": "How do I configure S3 bucket policies?",
        "keywords": [], "expected_services": [], "question_type": "factual",
        "mcp_results": [], "graph_docs": [], "mcp_read_docs": [],
        "answer": "", "citation_ranks": [], "citations": [], "related_docs": [],
        "total_tokens": 0, "total_cost_usd": 0.0,
        "degraded": False, "degraded_reason": "", "truncated": False, "started_at": "",
        **kwargs,
    }


def test_plan_node_extracts_keywords():
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text='{"keywords": ["S3", "bucket", "policy"], "expected_services": ["S3"], "question_type": "factual"}')]
    with patch("app.agents.nodes.plan._get_client") as mock_client:
        mock_client.return_value.messages.create.return_value = mock_msg
        result = plan_node(make_state())
    assert "S3" in result["keywords"]
    assert result["question_type"] == "factual"


def test_plan_node_falls_back_on_error():
    with patch("app.agents.nodes.plan._get_client") as mock_client:
        mock_client.return_value.messages.create.side_effect = Exception("API error")
        result = plan_node(make_state())
    assert isinstance(result["keywords"], list)
    assert result["question_type"] == "factual"


def test_fallback_keyword_extractor():
    kws = _extract_keywords_fallback("How do I configure Lambda function timeout settings?")
    assert len(kws) > 0
    assert all(len(k) > 3 for k in kws)
```

Create `agent-service/tests/unit/test_agents/__init__.py`:
```python
```

- [ ] **Step 11: Run Python unit tests**

```bash
cd agent-service && pytest tests/unit/test_agents/ -v
```

Expected:
```
tests/unit/test_agents/test_plan_node.py::test_plan_node_extracts_keywords PASSED
tests/unit/test_agents/test_plan_node.py::test_plan_node_falls_back_on_error PASSED
tests/unit/test_agents/test_plan_node.py::test_fallback_keyword_extractor PASSED
3 passed
```

- [ ] **Step 12: Add langgraph to requirements**

Add to `agent-service/requirements.txt`:
```
langgraph==0.2.0
langchain-anthropic==0.1.23
anthropic==0.28.0
```

Run: `pip install langgraph langchain-anthropic anthropic`

- [ ] **Step 13: Commit**

```bash
cd .. && git add agent-service/ && git commit -m "feat: add LangGraph 5-node agent pipeline with plan node unit tests"
```

---

### Day 6 Done

Verify:
- [ ] `cd api-service && mvn test` — all tests pass including ArchUnit
- [ ] `cd agent-service && pytest tests/unit/ -v` — all unit tests pass
- [ ] `GET /v1/healthz` returns `{"status":"ok"}` locally
- [ ] `git log --oneline -3` shows 2 new commits
