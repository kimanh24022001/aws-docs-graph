package com.awsdocs.adapter.out.agent;

import com.awsdocs.application.port.out.EmbeddingPort;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class EmbeddingClient implements EmbeddingPort {

  private static final Logger log = LoggerFactory.getLogger(EmbeddingClient.class);

  private final String agentServiceUrl;
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final HttpClient httpClient =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(5))
          .version(HttpClient.Version.HTTP_1_1)
          .build();

  public EmbeddingClient(@Value("${agent.service.url}") String agentServiceUrl) {
    this.agentServiceUrl = agentServiceUrl;
  }

  @Override
  @SuppressWarnings("unchecked")
  public List<Double> embed(String text) {
    try {
      var body = objectMapper.writeValueAsString(Map.of("text", text));
      var request = HttpRequest.newBuilder()
          .uri(URI.create(agentServiceUrl + "/internal/embed"))
          .header("Content-Type", "application/json; charset=utf-8")
          .POST(HttpRequest.BodyPublishers.ofString(body))
          .timeout(Duration.ofSeconds(10))
          .build();

      var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() != 200) {
        log.warn("Embed service returned {}", response.statusCode());
        return Collections.emptyList();
      }

      var result = objectMapper.readValue(response.body(), Map.class);
      return (List<Double>) result.get("embedding");
    } catch (Exception e) {
      log.warn("Embed call failed: {}", e.getMessage());
      return Collections.emptyList();
    }
  }
}
