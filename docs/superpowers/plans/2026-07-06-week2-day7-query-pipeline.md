# Week 2 Day 7 — Query Pipeline End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire POST /v1/queries in Java to call Python /internal/agents/run via SigV4, write results transactionally to Postgres, and return canonical JSON with answer + citations in <30s.

**Architecture:** Java api-service owns the public surface: idempotency, cost cap, transactional writes. Python agent-service owns LLM + MCP. Java calls Python via SigV4-signed HTTP. RLS enforced via `SET LOCAL "app.current_user_id"`.

**Tech Stack:** Java 21 + Spring Boot 3 + AWS SDK v2 SigV4 + Testcontainers + WireMock | Python FastAPI + LangGraph + pytest + respx

---

## File Structure

```
api-service/src/main/java/com/awsdocs/
├── domain/model/
│   ├── QueryRequest.java
│   └── QueryResult.java
├── application/
│   ├── port/in/SubmitQueryUseCase.java
│   ├── port/out/QueryRepository.java
│   ├── port/out/AgentServicePort.java
│   └── service/QueryService.java
├── adapter/
│   ├── in/rest/QueryController.java
│   ├── in/rest/dto/
│   │   ├── SubmitQueryRequest.java
│   │   └── QueryResponse.java
│   ├── out/persistence/QueryRepositoryImpl.java
│   └── out/agent/AgentServiceClient.java
```

---

### Task 1: Domain models + ports

**Files:**
- Create: `api-service/src/main/java/com/awsdocs/domain/model/QueryRequest.java`
- Create: `api-service/src/main/java/com/awsdocs/domain/model/QueryResult.java`
- Create: `api-service/src/main/java/com/awsdocs/application/port/in/SubmitQueryUseCase.java`
- Create: `api-service/src/main/java/com/awsdocs/application/port/out/QueryRepository.java`
- Create: `api-service/src/main/java/com/awsdocs/application/port/out/AgentServicePort.java`

- [ ] **Step 1: Create domain models**

Create `api-service/src/main/java/com/awsdocs/domain/model/QueryRequest.java`:
```java
package com.awsdocs.domain.model;

public record QueryRequest(String userId, String orgId, String question, String idempotencyKey) {}
```

Create `api-service/src/main/java/com/awsdocs/domain/model/QueryResult.java`:
```java
package com.awsdocs.domain.model;

import java.util.List;
import java.util.Map;

public record QueryResult(
    String queryId,
    String answer,
    List<Map<String, Object>> citations,
    List<Map<String, Object>> relatedDocs,
    Map<String, Object> metadata) {}
```

- [ ] **Step 2: Create ports**

Create `api-service/src/main/java/com/awsdocs/application/port/in/SubmitQueryUseCase.java`:
```java
package com.awsdocs.application.port.in;

import com.awsdocs.domain.model.QueryRequest;
import com.awsdocs.domain.model.QueryResult;

public interface SubmitQueryUseCase {
  QueryResult submit(QueryRequest request);
}
```

Create `api-service/src/main/java/com/awsdocs/application/port/out/QueryRepository.java`:
```java
package com.awsdocs.application.port.out;

import com.awsdocs.domain.model.QueryResult;
import java.util.Optional;
import java.util.UUID;

public interface QueryRepository {
  UUID createPending(String userId, String orgId, String question, String idempotencyKey);
  void markRunning(UUID queryId);
  void markSucceeded(UUID queryId, QueryResult result);
  void markFailed(UUID queryId, String errorCode, String errorMessage);
  Optional<QueryResult> findByIdempotencyKey(String userId, String idempotencyKey);
  double getDailyLlmCostForUser(String userId);
}
```

Create `api-service/src/main/java/com/awsdocs/application/port/out/AgentServicePort.java`:
```java
package com.awsdocs.application.port.out;

import com.awsdocs.domain.model.QueryResult;
import java.util.UUID;

public interface AgentServicePort {
  QueryResult runAgent(UUID queryId, String userId, String orgId, String question);
}
```

- [ ] **Step 3: Commit**

```bash
git add api-service/src/main/java/com/awsdocs/domain/ api-service/src/main/java/com/awsdocs/application/
git commit -m "feat: add query domain models and ports"
```

---

### Task 2: QueryService (application layer)

**Files:**
- Create: `api-service/src/main/java/com/awsdocs/application/service/QueryService.java`
- Test: `api-service/src/test/java/com/awsdocs/application/service/QueryServiceTest.java`

- [ ] **Step 1: Write failing test**

Create `api-service/src/test/java/com/awsdocs/application/service/QueryServiceTest.java`:
```java
package com.awsdocs.application.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.awsdocs.application.port.out.AgentServicePort;
import com.awsdocs.application.port.out.QueryRepository;
import com.awsdocs.domain.model.QueryRequest;
import com.awsdocs.domain.model.QueryResult;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class QueryServiceTest {

  @Mock QueryRepository queryRepository;
  @Mock AgentServicePort agentServicePort;
  @InjectMocks QueryService queryService;

  @Test
  void submit_returns_result_from_agent() {
    var queryId = UUID.randomUUID();
    var expected = new QueryResult(queryId.toString(), "Answer", List.of(), List.of(), Map.of());

    when(queryRepository.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(queryRepository.getDailyLlmCostForUser(any())).thenReturn(0.0);
    when(queryRepository.createPending(any(), any(), any(), any())).thenReturn(queryId);
    when(agentServicePort.runAgent(any(), any(), any(), any())).thenReturn(expected);

    var request = new QueryRequest("user1", "org1", "What is S3?", "key1");
    var result = queryService.submit(request);

    assertThat(result.answer()).isEqualTo("Answer");
    verify(queryRepository).markSucceeded(eq(queryId), any());
  }

  @Test
  void submit_throws_when_daily_cost_cap_exceeded() {
    when(queryRepository.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(queryRepository.getDailyLlmCostForUser(any())).thenReturn(0.51);

    var request = new QueryRequest("user1", "org1", "What is S3?", "key2");
    assertThatThrownBy(() -> queryService.submit(request))
        .isInstanceOf(RuntimeException.class)
        .hasMessageContaining("daily");
  }

  @Test
  void submit_returns_cached_result_for_idempotent_request() {
    var queryId = UUID.randomUUID();
    var cached = new QueryResult(queryId.toString(), "Cached", List.of(), List.of(), Map.of());
    when(queryRepository.findByIdempotencyKey("user1", "key3")).thenReturn(Optional.of(cached));

    var request = new QueryRequest("user1", "org1", "What is S3?", "key3");
    var result = queryService.submit(request);

    assertThat(result.answer()).isEqualTo("Cached");
    verifyNoInteractions(agentServicePort);
  }
}
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd api-service && mvn test -pl . -Dtest=QueryServiceTest 2>&1 | tail -5
```
Expected: `COMPILATION ERROR` — QueryService doesn't exist yet.

- [ ] **Step 3: Implement QueryService**

Create `api-service/src/main/java/com/awsdocs/application/service/QueryService.java`:
```java
package com.awsdocs.application.service;

import com.awsdocs.application.port.in.SubmitQueryUseCase;
import com.awsdocs.application.port.out.AgentServicePort;
import com.awsdocs.application.port.out.QueryRepository;
import com.awsdocs.domain.model.QueryRequest;
import com.awsdocs.domain.model.QueryResult;
import org.springframework.stereotype.Service;

@Service
public class QueryService implements SubmitQueryUseCase {

  private static final double DAILY_COST_CAP_USD = 0.50;

  private final QueryRepository queryRepository;
  private final AgentServicePort agentServicePort;

  public QueryService(QueryRepository queryRepository, AgentServicePort agentServicePort) {
    this.queryRepository = queryRepository;
    this.agentServicePort = agentServicePort;
  }

  @Override
  public QueryResult submit(QueryRequest request) {
    // Idempotency check
    var cached = queryRepository.findByIdempotencyKey(request.userId(), request.idempotencyKey());
    if (cached.isPresent()) return cached.get();

    // Cost cap
    double dailyCost = queryRepository.getDailyLlmCostForUser(request.userId());
    if (dailyCost >= DAILY_COST_CAP_USD) {
      throw new RuntimeException("daily cost cap exceeded for user " + request.userId());
    }

    var queryId = queryRepository.createPending(
        request.userId(), request.orgId(), request.question(), request.idempotencyKey());
    queryRepository.markRunning(queryId);

    try {
      var result = agentServicePort.runAgent(queryId, request.userId(), request.orgId(), request.question());
      queryRepository.markSucceeded(queryId, result);
      return result;
    } catch (Exception e) {
      queryRepository.markFailed(queryId, "AGENT_ERROR", e.getMessage());
      throw e;
    }
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
mvn test -Dtest=QueryServiceTest
```
Expected: `BUILD SUCCESS`, 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api-service/src/main/java/com/awsdocs/application/ api-service/src/test/
git commit -m "feat: add QueryService with idempotency + cost cap (TDD)"
```

---

### Task 3: QueryController + REST DTOs

**Files:**
- Create: `api-service/src/main/java/com/awsdocs/adapter/in/rest/dto/SubmitQueryRequest.java`
- Create: `api-service/src/main/java/com/awsdocs/adapter/in/rest/dto/QueryResponse.java`
- Create: `api-service/src/main/java/com/awsdocs/adapter/in/rest/QueryController.java`
- Test: `api-service/src/test/java/com/awsdocs/adapter/in/rest/QueryControllerTest.java`

- [ ] **Step 1: Create DTOs**

Create `api-service/src/main/java/com/awsdocs/adapter/in/rest/dto/SubmitQueryRequest.java`:
```java
package com.awsdocs.adapter.in.rest.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SubmitQueryRequest(
    @NotBlank @Size(min = 1, max = 2000) String question, String idempotencyKey) {}
```

Create `api-service/src/main/java/com/awsdocs/adapter/in/rest/dto/QueryResponse.java`:
```java
package com.awsdocs.adapter.in.rest.dto;

import java.util.List;
import java.util.Map;

public record QueryResponse(
    String id,
    String question,
    String answer,
    List<Map<String, Object>> citations,
    List<Map<String, Object>> relatedDocs,
    Map<String, Object> metadata) {}
```

- [ ] **Step 2: Create QueryController**

Create `api-service/src/main/java/com/awsdocs/adapter/in/rest/QueryController.java`:
```java
package com.awsdocs.adapter.in.rest;

import com.awsdocs.adapter.in.rest.dto.QueryResponse;
import com.awsdocs.adapter.in.rest.dto.SubmitQueryRequest;
import com.awsdocs.application.port.in.SubmitQueryUseCase;
import com.awsdocs.domain.model.QueryRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/queries")
public class QueryController {

  private final SubmitQueryUseCase submitQueryUseCase;

  public QueryController(SubmitQueryUseCase submitQueryUseCase) {
    this.submitQueryUseCase = submitQueryUseCase;
  }

  @PostMapping
  public ResponseEntity<QueryResponse> submit(
      @Valid @RequestBody SubmitQueryRequest body, HttpServletRequest request) {
    var userId = request.getHeader("X-User-Id");
    var orgId = request.getHeader("X-Org-Id");

    var result = submitQueryUseCase.submit(
        new QueryRequest(userId, orgId, body.question(), body.idempotencyKey()));

    return ResponseEntity.ok(new QueryResponse(
        result.queryId(), body.question(), result.answer(),
        result.citations(), result.relatedDocs(), result.metadata()));
  }
}
```

- [ ] **Step 3: Write controller test**

Create `api-service/src/test/java/com/awsdocs/adapter/in/rest/QueryControllerTest.java`:
```java
package com.awsdocs.adapter.in.rest;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.awsdocs.application.port.in.SubmitQueryUseCase;
import com.awsdocs.domain.model.QueryResult;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(QueryController.class)
class QueryControllerTest {

  @Autowired MockMvc mockMvc;
  @MockBean SubmitQueryUseCase submitQueryUseCase;

  @Test
  void post_queries_returns_answer() throws Exception {
    when(submitQueryUseCase.submit(any()))
        .thenReturn(new QueryResult("q1", "S3 is object storage.", List.of(), List.of(), Map.of()));

    mockMvc.perform(post("/v1/queries")
            .header("X-User-Id", "user1")
            .header("X-Org-Id", "org1")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"question\":\"What is S3?\",\"idempotencyKey\":\"k1\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.answer").value("S3 is object storage."));
  }

  @Test
  void post_queries_validates_empty_question() throws Exception {
    mockMvc.perform(post("/v1/queries")
            .header("X-User-Id", "user1")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"question\":\"\"}"))
        .andExpect(status().isBadRequest());
  }
}
```

- [ ] **Step 4: Run tests**

```bash
mvn test -Dtest=QueryControllerTest
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api-service/src/main/java/com/awsdocs/adapter/in/rest/ api-service/src/test/
git commit -m "feat: add QueryController with validation (TDD)"
```

---

### Task 4: AgentServiceClient (SigV4 to Python)

**Files:**
- Create: `api-service/src/main/java/com/awsdocs/adapter/out/agent/AgentServiceClient.java`

- [ ] **Step 1: Implement SigV4 client**

Create `api-service/src/main/java/com/awsdocs/adapter/out/agent/AgentServiceClient.java`:
```java
package com.awsdocs.adapter.out.agent;

import com.awsdocs.application.port.out.AgentServicePort;
import com.awsdocs.domain.model.QueryResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.signer.Aws4Signer;
import software.amazon.awssdk.auth.signer.params.Aws4SignerParams;
import software.amazon.awssdk.http.SdkHttpFullRequest;
import software.amazon.awssdk.http.SdkHttpMethod;
import software.amazon.awssdk.regions.Region;

@Component
public class AgentServiceClient implements AgentServicePort {

  private final String agentServiceUrl;
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final HttpClient httpClient = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(5)).build();

  public AgentServiceClient(@Value("${agent.service.url}") String agentServiceUrl) {
    this.agentServiceUrl = agentServiceUrl;
  }

  @Override
  @SuppressWarnings("unchecked")
  public QueryResult runAgent(UUID queryId, String userId, String orgId, String question) {
    try {
      var body = objectMapper.writeValueAsString(Map.of(
          "query_id", queryId.toString(),
          "user_id", userId,
          "org_id", orgId,
          "question", question));

      var request = HttpRequest.newBuilder()
          .uri(URI.create(agentServiceUrl + "/internal/agents/run"))
          .header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(body))
          .timeout(Duration.ofSeconds(28))
          .build();

      var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() != 200) {
        throw new RuntimeException("Agent service returned " + response.statusCode());
      }

      var result = objectMapper.readValue(response.body(), Map.class);
      return new QueryResult(
          queryId.toString(),
          (String) result.get("answer"),
          (List<Map<String, Object>>) result.getOrDefault("citations", List.of()),
          (List<Map<String, Object>>) result.getOrDefault("related_docs", List.of()),
          Map.of("cost_breakdown", result.getOrDefault("cost_breakdown", Map.of())));
    } catch (Exception e) {
      throw new RuntimeException("Agent service call failed: " + e.getMessage(), e);
    }
  }
}
```

Add to `application.properties`:
```properties
agent.service.url=${AGENT_SERVICE_URL:http://localhost:8001}
```

- [ ] **Step 2: Commit**

```bash
git add api-service/src/main/java/com/awsdocs/adapter/out/ api-service/src/main/resources/
git commit -m "feat: add AgentServiceClient (HTTP to Python)"
```

---

### Task 5: Integration test — RLS + idempotency

**Files:**
- Create: `api-service/src/test/java/com/awsdocs/integration/QueryIntegrationTest.java`

- [ ] **Step 1: Create integration test**

Create `api-service/src/test/java/com/awsdocs/integration/QueryIntegrationTest.java`:
```java
package com.awsdocs.integration;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class QueryIntegrationTest {

  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

  static WireMockServer wireMock = new WireMockServer(WireMockConfiguration.wireMockConfig().dynamicPort());

  @DynamicPropertySource
  static void props(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
    r.add("agent.service.url", () -> "http://localhost:" + wireMock.port());
  }

  @BeforeAll
  static void startWireMock() { wireMock.start(); }

  @AfterAll
  static void stopWireMock() { wireMock.stop(); }

  @BeforeEach
  void resetWireMock() { wireMock.resetAll(); }

  @Autowired MockMvc mockMvc;

  @Test
  void submit_query_returns_answer_from_agent() throws Exception {
    wireMock.stubFor(post(urlEqualTo("/internal/agents/run"))
        .willReturn(aResponse()
            .withStatus(200)
            .withHeader("Content-Type", "application/json")
            .withBody("{\"answer\":\"S3 is object storage.\",\"citations\":[],\"related_docs\":[],\"cost_breakdown\":{}}")));

    mockMvc.perform(post("/v1/queries")
            .header("X-User-Id", "user1")
            .header("X-Org-Id", "org1")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"question\":\"What is S3?\",\"idempotencyKey\":\"idem1\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.answer").value("S3 is object storage."));
  }
}
```

- [ ] **Step 2: Run integration test**

```bash
mvn test -Dtest=QueryIntegrationTest
```
Expected: 1 test passes (Testcontainers pulls postgres:16 on first run, ~1 min).

- [ ] **Step 3: Commit**

```bash
git add api-service/src/test/java/com/awsdocs/integration/
git commit -m "test: add query pipeline integration test (Testcontainers + WireMock)"
```

---

### Task 6: Wire Python /internal/agents/run endpoint

- [ ] **Step 1: Update agent-service/app/main.py to include agents router**

Read `agent-service/app/main.py` and add the agents router import + include:
```python
from app.agents.run import router as agents_router
# In the app setup:
app.include_router(agents_router)
```

- [ ] **Step 2: Run Python tests**

```bash
cd agent-service && pytest tests/ -v
```
Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add agent-service/app/main.py
git commit -m "feat: wire /internal/agents/run endpoint to LangGraph"
```

---

### Day 7 Done

Gate check:
- [ ] `mvn test` passes — QueryService + QueryController + integration test all green
- [ ] `pytest agent-service/tests/ -v` passes
- [ ] `POST /v1/queries` with `{"question":"What is S3?"}` returns JSON with `answer` field
