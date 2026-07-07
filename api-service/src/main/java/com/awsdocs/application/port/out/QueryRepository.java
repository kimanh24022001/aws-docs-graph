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
