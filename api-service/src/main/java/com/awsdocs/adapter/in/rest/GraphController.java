package com.awsdocs.adapter.in.rest;

import com.awsdocs.application.port.out.GraphRepository;
import java.util.List;
import java.util.Map;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/graph")
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
                n ->
                    ((List<Map<String, Object>>) n.getOrDefault("edges", List.of()))
                        .stream()
                            .map(
                                e ->
                                    Map.of(
                                        "source", n.get("id"),
                                        "target", e.get("id"),
                                        "type", e.get("type"))))
            .toList();
    return Map.of("nodes", nodes, "edges", edges);
  }

  @GetMapping("/documents/{id}")
  public Map<String, Object> document(@PathVariable String id) {
    return graphRepository.getDocument(id);
  }

  @GetMapping("/documents/{id}/neighbors")
  public List<Map<String, Object>> neighbors(
      @PathVariable String id, @RequestParam(defaultValue = "1") int hops) {
    return graphRepository.getNeighbors(id, Math.min(hops, 2), 200);
  }

  @GetMapping("/search")
  public List<Map<String, Object>> search(@RequestParam String q) {
    return graphRepository.search(q, 20);
  }
}
