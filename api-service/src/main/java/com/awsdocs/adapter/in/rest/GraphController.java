package com.awsdocs.adapter.in.rest;

import com.awsdocs.application.port.out.GraphRepository;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/graph")
@Validated
public class GraphController {

  private final GraphRepository graphRepository;

  public GraphController(GraphRepository graphRepository) {
    this.graphRepository = graphRepository;
  }

  @GetMapping("/overview")
  @Cacheable(value = "graph-overview", key = "'overview'")
  public Map<String, Object> overview() {
    var nodes = graphRepository.getOverview(2000);
    var edges =
        nodes.stream()
            .flatMap(
                n -> {
                  @SuppressWarnings("unchecked")
                  var edgeList = (List<Map<String, Object>>) n.getOrDefault("edges", List.of());
                  return edgeList.stream()
                      .filter(e -> e.get("id") != null)
                      .map(
                          e ->
                              Map.of(
                                  "source", n.get("id"),
                                  "target", e.get("id"),
                                  "type", e.getOrDefault("type", "LINKS_TO")));
                })
            .toList();
    return Map.of("nodes", nodes, "edges", edges);
  }

  @GetMapping("/documents/{id}")
  public ResponseEntity<Map<String, Object>> document(@PathVariable String id) {
    var doc = graphRepository.getDocument(id);
    if (doc.isEmpty()) {
      return ResponseEntity.notFound().build();
    }
    return ResponseEntity.ok(doc);
  }

  @GetMapping("/documents/{id}/neighbors")
  public List<Map<String, Object>> neighbors(
      @PathVariable String id, @RequestParam(defaultValue = "1") int hops) {
    return graphRepository.getNeighbors(id, Math.min(hops, 2), 200);
  }

  @GetMapping("/search")
  public List<Map<String, Object>> search(@RequestParam @Size(min = 1, max = 200) String q) {
    return graphRepository.search(q, 20);
  }
}
