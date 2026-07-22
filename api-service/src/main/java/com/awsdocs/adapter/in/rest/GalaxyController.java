package com.awsdocs.adapter.in.rest;

import com.awsdocs.application.port.out.GraphRepository;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;
import java.util.Map;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/graph")
@Validated
public class GalaxyController {

  private final GraphRepository graphRepository;

  public GalaxyController(GraphRepository graphRepository) {
    this.graphRepository = graphRepository;
  }

  @GetMapping("/clusters")
  @Cacheable(value = "graph-clusters", key = "'clusters'")
  public Map<String, Object> clusters() {
    return Map.of("clusters", graphRepository.getClusters());
  }

  @GetMapping("/clusters/{communityId}/services")
  public Map<String, Object> servicesInCluster(@PathVariable String communityId) {
    return Map.of("services", graphRepository.getServicesInCluster(communityId));
  }

  @GetMapping("/services/{service}/concepts")
  public Map<String, Object> conceptsForService(@PathVariable String service) {
    return Map.of("concepts", graphRepository.getConceptsForService(service));
  }

  @GetMapping("/focus/{nodeId}")
  public ResponseEntity<Map<String, Object>> focus(
      @PathVariable String nodeId,
      @RequestParam(defaultValue = "50") @Min(1) @Max(200) int limit) {
    var result = graphRepository.getFocusSubgraph(nodeId, limit);
    if (result.isEmpty()) return ResponseEntity.notFound().build();
    return ResponseEntity.ok(result);
  }
}
