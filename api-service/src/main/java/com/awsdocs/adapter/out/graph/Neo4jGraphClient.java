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
              WHERE NOT d.placeholder = true
              WITH d, size([(d)-[]-() | 1]) AS degree
              ORDER BY degree DESC
              LIMIT $limit
              OPTIONAL MATCH (d)-[r]->(neighbor:Document)
              WHERE NOT neighbor.placeholder = true
              RETURN d.id AS id, d.url AS url, d.title AS title,
                     d.service AS service, degree,
                     collect({id: neighbor.id, type: type(r)})[0..5] AS edges
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
              WHERE NOT neighbor.placeholder = true AND neighbor.id <> $id
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
}
