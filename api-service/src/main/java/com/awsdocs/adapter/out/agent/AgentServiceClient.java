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

@Component
public class AgentServiceClient implements AgentServicePort {

  private final String agentServiceUrl;
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final HttpClient httpClient =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

  public AgentServiceClient(@Value("${agent.service.url}") String agentServiceUrl) {
    this.agentServiceUrl = agentServiceUrl;
  }

  @Override
  @SuppressWarnings("unchecked")
  public QueryResult runAgent(UUID queryId, String userId, String orgId, String question) {
    try {
      var body =
          objectMapper.writeValueAsString(
              Map.of(
                  "query_id", queryId.toString(),
                  "user_id", userId,
                  "org_id", orgId,
                  "question", question));

      var request =
          HttpRequest.newBuilder()
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
