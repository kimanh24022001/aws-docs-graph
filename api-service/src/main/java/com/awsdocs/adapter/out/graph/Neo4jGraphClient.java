package com.awsdocs.adapter.out.graph;

import com.awsdocs.application.port.out.GraphRepository;
import java.util.List;
import java.util.Map;
import org.neo4j.driver.Driver;
import org.neo4j.driver.Session;
import org.springframework.stereotype.Component;

@Component
public class Neo4jGraphClient implements GraphRepository {

  private final Driver driver;

  public Neo4jGraphClient(Driver driver) {
    this.driver = driver;
  }

  @Override
  public List<Map<String, Object>> getOverview(int limit) {
    try (Session session = driver.session()) {
      return session
          .run(
              """
              MATCH (d:Document)
              WHERE d.placeholder IS NULL OR d.placeholder = false
              WITH d, size([(d)-[]-() | 1]) AS degree
              ORDER BY degree DESC
              LIMIT $limit
              WITH collect(d) AS topNodes
              UNWIND topNodes AS d
              WITH d, topNodes
              OPTIONAL MATCH (d)-[r]->(neighbor:Document)
              WHERE neighbor IN topNodes
              RETURN d.id AS id, d.url AS url, d.title AS title,
                     d.service AS service, d.community_id AS communityId,
                     size([(d)-[]-() | 1]) AS degree,
                     collect({id: neighbor.id, type: type(r)})[0..10] AS edges
              """,
              Map.of("limit", limit))
          .list(
              r ->
                  Map.of(
                      "id", r.get("id").asString(""),
                      "url", r.get("url").asString(""),
                      "title", r.get("title").asString(""),
                      "service", r.get("service").asString(""),
                      "communityId", r.get("communityId").asString(""),
                      "degree", r.get("degree").asInt(0),
                      "edges", r.get("edges").asList()));
    }
  }

  @Override
  public List<Map<String, Object>> getNeighbors(String documentId, int hops, int limit) {
    try (Session session = driver.session()) {
      return session
          .run(
              """
              MATCH (src:Document {id: $id})-[r*1..$hops]-(neighbor:Document)
              WHERE (neighbor.placeholder IS NULL OR neighbor.placeholder = false) AND neighbor.id <> $id
              RETURN DISTINCT neighbor.id AS id, neighbor.url AS url,
                     neighbor.title AS title, neighbor.service AS service
              LIMIT $limit
              """,
              Map.of("id", documentId, "hops", hops, "limit", limit))
          .list(
              r ->
                  Map.of(
                      "id", r.get("id").asString(""),
                      "url", r.get("url").asString(""),
                      "title", r.get("title").asString(""),
                      "service", r.get("service").asString("")));
    }
  }

  @Override
  public Map<String, Object> getDocument(String documentId) {
    try (Session session = driver.session()) {
      var result =
          session.run(
              "MATCH (d:Document {id: $id})"
                  + " RETURN d.id AS id, d.url AS url, d.title AS title,"
                  + " d.service AS service, d.word_count AS wordCount",
              Map.of("id", documentId));
      if (!result.hasNext()) return Map.of();
      var r = result.next();
      return Map.of(
          "id", r.get("id").asString(""),
          "url", r.get("url").asString(""),
          "title", r.get("title").asString(""),
          "service", r.get("service").asString(""),
          "wordCount", r.get("wordCount").asInt(0));
    }
  }

  @Override
  public List<Map<String, Object>> search(String query, int limit) {
    try (Session session = driver.session()) {
      return session
          .run(
              """
              MATCH (d:Document)
              WHERE toLower(d.title) CONTAINS toLower($query)
                 OR toLower(d.url) CONTAINS toLower($query)
              RETURN d.id AS id, d.url AS url, d.title AS title, d.service AS service
              LIMIT $limit
              """,
              Map.of("query", query, "limit", limit))
          .list(
              r ->
                  Map.of(
                      "id", r.get("id").asString(""),
                      "url", r.get("url").asString(""),
                      "title", r.get("title").asString(""),
                      "service", r.get("service").asString("")));
    }
  }

  @Override
  public List<Map<String, Object>> getCrossServiceEdges() {
    // Aggregate CROSS_SERVICE edges to category-level connections
    var categoryEdges = new java.util.HashMap<String, Integer>();
    var edgeLabels = new java.util.HashMap<String, String>();
    try (Session session = driver.session()) {
      session.run("""
          MATCH (a:Document)-[r:CROSS_SERVICE]->(b:Document)
          WHERE a.service IS NOT NULL AND b.service IS NOT NULL
          RETURN a.service AS src, b.service AS tgt,
                 r.rel_type AS relType, r.weight AS weight
          """)
          .list()
          .forEach(r -> {
            String srcCat = com.awsdocs.domain.model.ServiceCategory.categoryFor(r.get("src").asString(""));
            String tgtCat = com.awsdocs.domain.model.ServiceCategory.categoryFor(r.get("tgt").asString(""));
            if (!srcCat.equals(tgtCat) && !srcCat.equals("Other") && !tgtCat.equals("Other")) {
              // Use sorted key to deduplicate A→B and B→A
              String key = srcCat.compareTo(tgtCat) < 0
                  ? srcCat + "|" + tgtCat
                  : tgtCat + "|" + srcCat;
              categoryEdges.merge(key, r.get("weight").asInt(1), Integer::sum);
              edgeLabels.putIfAbsent(key, r.get("relType").asString("INTEGRATES_WITH"));
            }
          });
    }
    return categoryEdges.entrySet().stream()
        .map(e -> {
          String[] parts = e.getKey().split("\\|");
          return Map.<String, Object>of(
              "source", parts[0],
              "target", parts[1],
              "weight", e.getValue(),
              "relType", edgeLabels.get(e.getKey()));
        })
        .toList();
  }

  @Override
  public List<Map<String, Object>> getClusters() {
    // Group documents by hardcoded category (service → category mapping)
    Map<String, Integer> serviceCounts = new java.util.HashMap<>();
    try (Session session = driver.session()) {
      session.run("""
          MATCH (d:Document)
          WHERE (d.placeholder IS NULL OR d.placeholder = false)
            AND d.service IS NOT NULL AND d.service <> ''
          RETURN d.service AS service, count(d) AS cnt
          """)
          .list()
          .forEach(r -> serviceCounts.merge(
              r.get("service").asString(""), r.get("cnt").asInt(0), Integer::sum));
    }

    // Aggregate services into categories
    Map<String, Integer> categoryCounts = new java.util.LinkedHashMap<>();
    Map<String, java.util.List<String>> categoryServices = new java.util.HashMap<>();
    for (var e : serviceCounts.entrySet()) {
      String category = com.awsdocs.domain.model.ServiceCategory.categoryFor(e.getKey());
      categoryCounts.merge(category, e.getValue(), Integer::sum);
      categoryServices.computeIfAbsent(category, k -> new java.util.ArrayList<>()).add(e.getKey());
    }

    return categoryCounts.entrySet().stream()
        .sorted((a, b) -> b.getValue() - a.getValue())
        .map(e -> Map.<String, Object>of(
            "id", e.getKey(),
            "label", e.getKey(),
            "nodeCount", e.getValue(),
            "services", categoryServices.get(e.getKey()).stream().sorted().limit(8).toList(),
            "centroidId", ""))
        .toList();
  }

  @Override
  public List<Map<String, Object>> getServicesInCluster(String category) {
    // Return documents whose service maps to the given category
    try (Session session = driver.session()) {
      var byService = new java.util.HashMap<String, Integer>();
      session.run("""
          MATCH (d:Document)
          WHERE (d.placeholder IS NULL OR d.placeholder = false)
            AND d.service IS NOT NULL AND d.service <> ''
          RETURN d.service AS service, count(d) AS nodeCount
          """)
          .list()
          .forEach(r -> {
            String svc = r.get("service").asString("");
            if (com.awsdocs.domain.model.ServiceCategory.categoryFor(svc).equals(category)) {
              byService.merge(svc, r.get("nodeCount").asInt(0), Integer::sum);
            }
          });
      return byService.entrySet().stream()
          .sorted((a, b) -> b.getValue() - a.getValue())
          .map(e -> Map.<String, Object>of("service", e.getKey(), "nodeCount", e.getValue()))
          .toList();
    }
  }

  @Override
  public List<Map<String, Object>> getConceptsForService(String service) {
    try (Session session = driver.session()) {
      return session.run("""
          MATCH (c:Concept {service: $service})
          RETURN c.id AS id, c.name AS name, c.level AS level,
                 c.source_doc_id AS sourceDocId
          ORDER BY c.level ASC, c.name ASC
          LIMIT 200
          """, Map.of("service", service))
          .list(r -> Map.of(
              "id", r.get("id").asString(""),
              "name", r.get("name").asString(""),
              "level", r.get("level").asInt(1),
              "sourceDocId", r.get("sourceDocId").asString("")));
    }
  }

  @Override
  public List<Map<String, Object>> getEvidence(String src, String tgt, String relType) {
    try (Session session = driver.session()) {
      return session.run("""
          MATCH (a:Document {service: $src})-[r:CROSS_SERVICE {rel_type: $relType}]->(b:Document {service: $tgt})
          WHERE r.evidence_text IS NOT NULL
          RETURN r.evidence_text AS evidence_text,
                 r.source_url AS source_url,
                 coalesce(r.source_doc_title, '') AS source_doc_title,
                 r.confidence AS confidence,
                 coalesce(r.extraction_method, 'rule_based') AS extraction_method
          ORDER BY r.confidence DESC
          LIMIT 5
          """, Map.of("src", src, "tgt", tgt, "relType", relType))
          .list(r -> Map.of(
              "evidence_text", r.get("evidence_text").asString(""),
              "source_url", r.get("source_url").asString(""),
              "source_doc_title", r.get("source_doc_title").asString(""),
              "confidence", r.get("confidence").asDouble(0.6),
              "extraction_method", r.get("extraction_method").asString("rule_based")));
    }
  }

  @Override
  public Map<String, Object> getFocusSubgraph(String nodeId, int limit) {
    try (Session session = driver.session()) {
      // BFS up to 3 hops, score = 1 / (distance * 2)
      var result = session.run("""
          MATCH (center:Document {id: $nodeId})
          CALL {
            WITH center
            MATCH path = (center)-[*1..3]-(neighbor:Document)
            WHERE (neighbor.placeholder IS NULL OR neighbor.placeholder = false)
              AND neighbor.id IS NOT NULL AND neighbor.id <> $nodeId
            WITH neighbor, min(length(path)) AS distance
            RETURN neighbor, distance,
                   1.0 / (distance * 2.0) AS gravityScore
            ORDER BY gravityScore DESC
            LIMIT $limit
          }
          RETURN center.id AS centerId, center.title AS centerTitle,
                 center.service AS centerService,
                 collect({
                   id: neighbor.id,
                   label: coalesce(neighbor.title, neighbor.url),
                   service: coalesce(neighbor.service, ''),
                   gravityScore: gravityScore,
                   distance: distance
                 }) AS nodes
          """, Map.of("nodeId", nodeId, "limit", limit))
          .list();

      if (result.isEmpty()) return Map.of();

      var r = result.get(0);
      @SuppressWarnings("unchecked")
      List<Map<String, Object>> nodes = (List<Map<String, Object>>) (List<?>) r.get("nodes").asList();
      var filteredNodes = nodes.stream()
          .filter(n -> {
            Object gs = n.get("gravityScore");
            return gs instanceof Number && ((Number) gs).doubleValue() >= 0.3;
          })
          .toList();

      var edges = filteredNodes.stream()
          .map(n -> Map.of(
              "source", r.get("centerId").asString(""),
              "target", n.get("id"),
              "weight", n.get("gravityScore")))
          .toList();

      return Map.of(
          "center", Map.of(
              "id", r.get("centerId").asString(""),
              "label", r.get("centerTitle").asString(""),
              "service", r.get("centerService").asString("")),
          "nodes", filteredNodes,
          "edges", edges);
    }
  }
}
