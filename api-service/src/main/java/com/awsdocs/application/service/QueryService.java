package com.awsdocs.application.service;

import com.awsdocs.application.port.in.SubmitQueryUseCase;
import com.awsdocs.application.port.out.AgentServicePort;
import com.awsdocs.application.port.out.EmbeddingPort;
import com.awsdocs.application.port.out.QueryRepository;
import com.awsdocs.application.port.out.UserVisitsRepository;
import com.awsdocs.domain.exception.CostCapExceededException;
import com.awsdocs.domain.model.QueryRequest;
import com.awsdocs.domain.model.QueryResult;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class QueryService implements SubmitQueryUseCase {

  private static final Logger log = LoggerFactory.getLogger(QueryService.class);
  private static final double DAILY_COST_CAP_USD = 0.50;

  private final QueryRepository queryRepository;
  private final AgentServicePort agentServicePort;
  private final UserVisitsRepository userVisitsRepository;
  private final EmbeddingPort embeddingPort;

  public QueryService(
      QueryRepository queryRepository,
      AgentServicePort agentServicePort,
      UserVisitsRepository userVisitsRepository,
      EmbeddingPort embeddingPort) {
    this.queryRepository = queryRepository;
    this.agentServicePort = agentServicePort;
    this.userVisitsRepository = userVisitsRepository;
    this.embeddingPort = embeddingPort;
  }

  @Override
  public QueryResult submit(QueryRequest request) {
    // Idempotency check (exact key match)
    var cached = queryRepository.findByIdempotencyKey(request.userId(), request.idempotencyKey());
    if (cached.isPresent()) return cached.get();

    // Semantic cache — embed question, find cosine-similar past answer (>0.85)
    List<Double> embedding = List.of();
    try {
      embedding = embeddingPort.embed(request.question());
      if (!embedding.isEmpty()) {
        String pgVec = toPgVector(embedding);
        var semantic = queryRepository.findByEmbedding(request.userId(), pgVec);
        if (semantic.isPresent()) return semantic.get();
      }
    } catch (Exception e) {
      log.warn("Embedding cache lookup failed, falling through: {}", e.getMessage());
    }

    // Trigram fallback
    var previous = queryRepository.findSimilarQuestion(request.userId(), request.question());
    if (previous.isPresent()) return previous.get();

    // Cost cap
    double dailyCost = queryRepository.getDailyLlmCostForUser(request.userId());
    if (dailyCost >= DAILY_COST_CAP_USD) throw new CostCapExceededException();

    var queryId = queryRepository.createPending(
        request.userId(), request.orgId(), request.question(), request.idempotencyKey());
    queryRepository.markRunning(queryId, request.userId());

    try {
      var result = agentServicePort.runAgent(
          queryId, request.userId(), request.orgId(), request.question());
      queryRepository.markSucceeded(queryId, request.userId(), result);
      upsertVisits(request.userId(), result.citations());
      // Store embedding for future cache hits
      if (!embedding.isEmpty()) {
        try {
          queryRepository.storeEmbedding(queryId, embedding);
        } catch (Exception e) {
          log.warn("Failed to store embedding: {}", e.getMessage());
        }
      }
      return result;
    } catch (Exception e) {
      queryRepository.markFailed(queryId, request.userId(), "AGENT_ERROR", e.getMessage());
      throw e;
    }
  }

  private String toPgVector(List<Double> vec) {
    return vec.stream().map(Object::toString).collect(Collectors.joining(",", "[", "]"));
  }

  private void upsertVisits(String userId, List<Map<String, Object>> citations) {
    if (citations == null) return;
    for (var citation : citations) {
      try {
        String url = (String) citation.get("url");
        if (url == null || url.isBlank()) continue;
        userVisitsRepository.upsertVisit(userId, url,
            (String) citation.get("title"), (String) citation.get("service"));
      } catch (Exception e) {
        log.warn("Failed to upsert visit: {}", e.getMessage());
      }
    }
  }
}
