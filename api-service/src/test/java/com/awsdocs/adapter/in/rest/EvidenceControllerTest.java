package com.awsdocs.adapter.in.rest;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.awsdocs.application.port.out.GraphRepository;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(GalaxyController.class)
class EvidenceControllerTest {

  @Autowired MockMvc mockMvc;
  @MockBean GraphRepository graphRepository;

  @Test
  void get_evidence_returns_list() throws Exception {
    when(graphRepository.getEvidence("lambda", "dynamodb", "TRIGGERS"))
        .thenReturn(List.of(Map.of(
            "evidence_text", "DynamoDB Streams triggers Lambda when items change",
            "source_url", "https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html",
            "source_doc_title", "Using Lambda with DynamoDB",
            "confidence", 0.92,
            "extraction_method", "llm")));

    mockMvc.perform(get("/v1/graph/evidence")
            .param("src", "lambda")
            .param("tgt", "dynamodb")
            .param("rel", "TRIGGERS"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.src").value("lambda"))
        .andExpect(jsonPath("$.tgt").value("dynamodb"))
        .andExpect(jsonPath("$.rel_type").value("TRIGGERS"))
        .andExpect(jsonPath("$.evidence[0].evidence_text").value("DynamoDB Streams triggers Lambda when items change"))
        .andExpect(jsonPath("$.evidence[0].confidence").value(0.92));
  }

  @Test
  void get_evidence_returns_empty_when_no_match() throws Exception {
    when(graphRepository.getEvidence("lambda", "rds", "TRIGGERS"))
        .thenReturn(List.of());

    mockMvc.perform(get("/v1/graph/evidence")
            .param("src", "lambda")
            .param("tgt", "rds")
            .param("rel", "TRIGGERS"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.evidence").isEmpty());
  }
}
