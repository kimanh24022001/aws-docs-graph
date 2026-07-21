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
class GalaxyControllerTest {

  @Autowired MockMvc mockMvc;
  @MockBean GraphRepository graphRepository;

  @Test
  void get_clusters_returns_list() throws Exception {
    when(graphRepository.getClusters())
        .thenReturn(List.of(Map.of(
            "id", "community-1",
            "label", "s3",
            "nodeCount", 312,
            "services", List.of("s3", "glacier"),
            "centroidId", "uuid-abc")));

    mockMvc.perform(get("/v1/graph/clusters"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.clusters[0].id").value("community-1"))
        .andExpect(jsonPath("$.clusters[0].nodeCount").value(312));
  }

  @Test
  void get_focus_returns_center_and_nodes() throws Exception {
    when(graphRepository.getFocusSubgraph("node-1", 50))
        .thenReturn(Map.of(
            "center", Map.of("id", "node-1", "label", "S3", "service", "s3"),
            "nodes", List.of(Map.of("id", "node-2", "label", "IAM", "gravityScore", 0.85)),
            "edges", List.of()));

    mockMvc.perform(get("/v1/graph/focus/node-1?limit=50"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.center.id").value("node-1"))
        .andExpect(jsonPath("$.nodes[0].gravityScore").value(0.85));
  }
}
