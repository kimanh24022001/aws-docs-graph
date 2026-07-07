package com.awsdocs.application.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.awsdocs.application.port.out.AgentServicePort;
import com.awsdocs.application.port.out.QueryRepository;
import com.awsdocs.domain.exception.CostCapExceededException;
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
    verify(queryRepository).markSucceeded(eq(queryId), eq("user1"), any());
  }

  @Test
  void submit_throws_cost_cap_exception_at_cap() {
    when(queryRepository.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(queryRepository.getDailyLlmCostForUser(any())).thenReturn(0.50);

    var request = new QueryRequest("user1", "org1", "What is S3?", "key2");
    assertThatThrownBy(() -> queryService.submit(request))
        .isInstanceOf(CostCapExceededException.class);
  }

  @Test
  void submit_throws_cost_cap_exception_above_cap() {
    when(queryRepository.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(queryRepository.getDailyLlmCostForUser(any())).thenReturn(0.51);

    var request = new QueryRequest("user1", "org1", "What is S3?", "key3");
    assertThatThrownBy(() -> queryService.submit(request))
        .isInstanceOf(CostCapExceededException.class);
  }

  @Test
  void submit_succeeds_just_below_cap() {
    var queryId = UUID.randomUUID();
    var expected = new QueryResult(queryId.toString(), "Answer", List.of(), List.of(), Map.of());
    when(queryRepository.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(queryRepository.getDailyLlmCostForUser(any())).thenReturn(0.499);
    when(queryRepository.createPending(any(), any(), any(), any())).thenReturn(queryId);
    when(agentServicePort.runAgent(any(), any(), any(), any())).thenReturn(expected);

    var request = new QueryRequest("user1", "org1", "What is S3?", "key4");
    var result = queryService.submit(request);
    assertThat(result.answer()).isEqualTo("Answer");
  }

  @Test
  void submit_marks_failed_when_agent_throws() {
    var queryId = UUID.randomUUID();
    when(queryRepository.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(queryRepository.getDailyLlmCostForUser(any())).thenReturn(0.0);
    when(queryRepository.createPending(any(), any(), any(), any())).thenReturn(queryId);
    when(agentServicePort.runAgent(any(), any(), any(), any()))
        .thenThrow(new RuntimeException("agent down"));

    var request = new QueryRequest("user1", "org1", "What is S3?", "key5");
    assertThatThrownBy(() -> queryService.submit(request)).isInstanceOf(RuntimeException.class);
    verify(queryRepository).markFailed(eq(queryId), eq("user1"), eq("AGENT_ERROR"), any());
  }

  @Test
  void submit_returns_cached_result_for_idempotent_request() {
    var queryId = UUID.randomUUID();
    var cached = new QueryResult(queryId.toString(), "Cached", List.of(), List.of(), Map.of());
    when(queryRepository.findByIdempotencyKey("user1", "key6")).thenReturn(Optional.of(cached));

    var request = new QueryRequest("user1", "org1", "What is S3?", "key6");
    var result = queryService.submit(request);

    assertThat(result.answer()).isEqualTo("Cached");
    verifyNoInteractions(agentServicePort);
  }
}
