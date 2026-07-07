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

    var queryId =
        queryRepository.createPending(
            request.userId(), request.orgId(), request.question(), request.idempotencyKey());
    queryRepository.markRunning(queryId);

    try {
      var result =
          agentServicePort.runAgent(queryId, request.userId(), request.orgId(), request.question());
      queryRepository.markSucceeded(queryId, result);
      return result;
    } catch (Exception e) {
      queryRepository.markFailed(queryId, "AGENT_ERROR", e.getMessage());
      throw e;
    }
  }
}
