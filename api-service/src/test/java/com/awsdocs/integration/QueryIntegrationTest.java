package com.awsdocs.integration;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import java.sql.DriverManager;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest(classes = com.awsdocs.infrastructure.config.SpringConfig.class)
@AutoConfigureMockMvc
@Testcontainers
class QueryIntegrationTest {

  static final String USER_ID = "00000000-0000-0000-0000-000000000001";
  static final String ORG_ID = "00000000-0000-0000-0000-000000000002";

  @Container
  static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

  // WireMock started in static initializer so its port is known before Spring context starts.
  static final WireMockServer wireMock;

  static {
    wireMock = new WireMockServer(WireMockConfiguration.wireMockConfig().dynamicPort());
    wireMock.start();
  }

  @DynamicPropertySource
  static void props(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
    r.add("agent.service.url", () -> "http://localhost:" + wireMock.port());
  }

  @Autowired MockMvc mockMvc;
  @Autowired JdbcTemplate jdbc;

  @BeforeAll
  static void initSchema() throws Exception {
    // Run schema SQL directly via JDBC before Spring context — container is up at this point
    var sql = new org.springframework.core.io.ClassPathResource("schema-test.sql");
    try (var conn =
        DriverManager.getConnection(
            postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())) {
      org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(conn, sql);

      // Seed: user + org + membership
      try (var stmt = conn.createStatement()) {
        stmt.execute(
            "insert into app.users(id, display_name) values ('"
                + USER_ID
                + "'::uuid, 'Test User')");
        stmt.execute(
            "insert into app.organizations(id, name, slug) values ('"
                + ORG_ID
                + "'::uuid, 'Test Org', 'test-org')");
        stmt.execute(
            "insert into app.org_memberships(org_id, user_id, role) values ('"
                + ORG_ID
                + "'::uuid, '"
                + USER_ID
                + "'::uuid, 'owner')");
      }
    }
  }

  @AfterAll
  static void stopWireMock() {
    wireMock.stop();
  }

  @BeforeEach
  void resetWireMock() {
    wireMock.resetAll();
  }

  @Test
  void submit_query_returns_answer_from_agent() throws Exception {
    wireMock.stubFor(
        WireMock.post(urlEqualTo("/internal/agents/run"))
            .willReturn(
                aResponse()
                    .withStatus(200)
                    .withHeader("Content-Type", "application/json")
                    .withBody(
                        "{\"answer\":\"S3 is object storage.\","
                            + "\"citations\":[],\"related_docs\":[],\"cost_breakdown\":{}}")));

    mockMvc
        .perform(
            MockMvcRequestBuilders.post("/v1/queries")
                .header("X-User-Id", USER_ID)
                .header("X-Org-Id", ORG_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"question\":\"What is S3?\",\"idempotencyKey\":\"idem-integration-1\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.answer").value("S3 is object storage."));
  }
}
