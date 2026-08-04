package com.awsdocs.application.port.out;

import com.awsdocs.domain.model.QueryResult;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public interface QueryRepository {
  UUID createPending(String userId, String orgId, String question, String idempotencyKey);

  void markRunning(UUID queryId, String userId);

  void markSucceeded(UUID queryId, String userId, QueryResult result);

  void markFailed(UUID queryId, String userId, String errorCode, String errorMessage);

  Optional<QueryResult> findByIdempotencyKey(String userId, String idempotencyKey);

  Optional<QueryResult> findSimilarQuestion(String userId, String question);

  Optional<QueryResult> findByEmbedding(String userId, String pgVector);

  void storeEmbedding(java.util.UUID queryId, java.util.List<Double> embedding);

  double getDailyLlmCostForUser(String userId);

  List<Map<String, Object>> listRecent(String userId, int limit);
}
