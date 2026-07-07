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

    mockMvc
        .perform(
            post("/v1/queries")
                .header("X-User-Id", "user1")
                .header("X-Org-Id", "org1")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"question\":\"What is S3?\",\"idempotencyKey\":\"k1\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.answer").value("S3 is object storage."));
  }

  @Test
  void post_queries_validates_empty_question() throws Exception {
    mockMvc
        .perform(
            post("/v1/queries")
                .header("X-User-Id", "user1")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"question\":\"\"}"))
        .andExpect(status().isBadRequest());
  }
}
