package com.awsdocs.adapter.in.rest;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
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

@WebMvcTest(GraphController.class)
class GraphControllerTest {

  @Autowired MockMvc mockMvc;
  @MockBean GraphRepository graphRepository;

  @Test
  void get_overview_returns_nodes_and_edges() throws Exception {
    when(graphRepository.getOverview(2000))
        .thenReturn(
            List.of(
                Map.of(
                    "id", "doc1",
                    "title", "S3 Overview",
                    "url", "https://docs.aws.amazon.com/s3",
                    "service", "S3",
                    "degree", 3,
                    "edges",
                        List.of(Map.of("id", "doc2", "type", "REFERENCES")))));

    mockMvc
        .perform(get("/v1/graph/overview"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.nodes[0].id").value("doc1"))
        .andExpect(jsonPath("$.edges[0].source").value("doc1"))
        .andExpect(jsonPath("$.edges[0].target").value("doc2"));
  }

  @Test
  void get_document_returns_document() throws Exception {
    when(graphRepository.getDocument("doc1"))
        .thenReturn(
            Map.of(
                "id", "doc1",
                "title", "S3 Overview",
                "url", "https://docs.aws.amazon.com/s3",
                "service", "S3",
                "wordCount", 500));

    mockMvc
        .perform(get("/v1/graph/documents/doc1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value("doc1"))
        .andExpect(jsonPath("$.service").value("S3"));
  }

  @Test
  void get_neighbors_returns_list() throws Exception {
    when(graphRepository.getNeighbors(eq("doc1"), eq(1), eq(200)))
        .thenReturn(
            List.of(
                Map.of(
                    "id", "doc2",
                    "title", "S3 Buckets",
                    "url", "https://docs.aws.amazon.com/s3/buckets",
                    "service", "S3")));

    mockMvc
        .perform(get("/v1/graph/documents/doc1/neighbors"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value("doc2"));
  }

  @Test
  void get_neighbors_caps_hops_at_two() throws Exception {
    when(graphRepository.getNeighbors(eq("doc1"), eq(2), eq(200))).thenReturn(List.of());

    mockMvc
        .perform(get("/v1/graph/documents/doc1/neighbors?hops=5"))
        .andExpect(status().isOk());
  }

  @Test
  void get_search_returns_results() throws Exception {
    when(graphRepository.search(eq("S3"), eq(20)))
        .thenReturn(
            List.of(
                Map.of(
                    "id", "doc1",
                    "title", "S3 Overview",
                    "url", "https://docs.aws.amazon.com/s3",
                    "service", "S3")));

    mockMvc
        .perform(get("/v1/graph/search?q=S3"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].service").value("S3"));
  }
}
