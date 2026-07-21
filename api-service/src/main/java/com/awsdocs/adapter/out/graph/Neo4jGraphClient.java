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
                     d.service AS service,
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
  public List<Map<String, Object>> getClusters() {
    try (Session session = driver.session()) {
      return session.run("""
          MATCH (d:Document)
          WHERE d.community_id IS NOT NULL
          WITH d.community_id AS cid, d.community_label AS label,
               count(d) AS nodeCount,
               collect(DISTINCT d.service)[0..6] AS services
          ORDER BY nodeCount DESC
          RETURN cid AS id, label, nodeCount, services,
                 head([(d2:Document {community_id: cid})-[]-() | d2.id]) AS centroidId
          LIMIT 30
          """)
          .list(r -> Map.of(
              "id", r.get("id").asString(""),
              "label", r.get("label").asString(""),
              "nodeCount", r.get("nodeCount").asInt(0),
              "services", r.get("services").asList(),
              "centroidId", r.get("centroidId").asString("")));
    }
  }

  @Override
  public List<Map<String, Object>> getServicesInCluster(String communityId) {
    try (Session session = driver.session()) {
      return session.run("""
          MATCH (d:Document {community_id: $cid})
          WHERE d.service IS NOT NULL AND d.service <> ''
          WITH d.service AS service, count(d) AS nodeCount
          ORDER BY nodeCount DESC
          RETURN service, nodeCount
          """, Map.of("cid", communityId))
          .list(r -> Map.of(
              "service", r.get("service").asString(""),
              "nodeCount", r.get("nodeCount").asInt(0)));
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
