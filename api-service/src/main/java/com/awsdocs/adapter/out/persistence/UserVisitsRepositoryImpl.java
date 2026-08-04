package com.awsdocs.adapter.out.persistence;

import com.awsdocs.application.port.out.UserVisitsRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class UserVisitsRepositoryImpl implements UserVisitsRepository {

  private final JdbcTemplate jdbc;

  public UserVisitsRepositoryImpl(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public void upsertVisit(String userId, String docUrl, String docTitle, String service) {
    jdbc.update(
        """
        INSERT INTO app.user_visits (user_id, doc_url, doc_title, service)
        VALUES (?::uuid, ?, ?, ?)
        ON CONFLICT (user_id, doc_url) DO UPDATE
          SET visit_count = app.user_visits.visit_count + 1,
              last_visited_at = now(),
              doc_title = EXCLUDED.doc_title
        """,
        userId, docUrl, docTitle != null ? docTitle : "", service != null ? service : "");
  }

  @Override
  @Transactional(readOnly = true)
  public Map<String, Object> getMyLearning(String userId) {
    List<Map<String, Object>> nodes = jdbc.query(
        """
        SELECT id::text, doc_url, doc_title, service, visit_count,
               first_visited_at, last_visited_at
        FROM app.user_visits
        WHERE user_id = ?::uuid
        ORDER BY last_visited_at DESC
        """,
        (rs, rowNum) -> {
          Map<String, Object> node = new HashMap<>();
          node.put("id", rs.getString("id"));
          node.put("url", rs.getString("doc_url"));
          node.put("title", rs.getString("doc_title"));
          node.put("service", rs.getString("service"));
          node.put("visitCount", rs.getInt("visit_count"));
          node.put("firstVisitedAt", rs.getTimestamp("first_visited_at").toInstant().toString());
          node.put("lastVisitedAt", rs.getTimestamp("last_visited_at").toInstant().toString());
          return node;
        },
        userId);

    // Build id → url index for edge lookup
    Map<String, String> urlToId = new HashMap<>();
    for (var node : nodes) {
      urlToId.put((String) node.get("url"), (String) node.get("id"));
    }

    // Co-citation edges: pairs of docs cited in the same query by this user
    List<Map<String, Object>> edges = jdbc.query(
        """
        SELECT d1.url AS src_url, d2.url AS tgt_url, COUNT(*) AS weight
        FROM app.query_citations qc1
        JOIN app.query_citations qc2
          ON qc1.query_id = qc2.query_id AND qc1.document_id < qc2.document_id
        JOIN app.queries q ON q.id = qc1.query_id AND q.user_id = ?::uuid
        JOIN app.documents d1 ON d1.id = qc1.document_id
        JOIN app.documents d2 ON d2.id = qc2.document_id
        WHERE d1.url IN (SELECT doc_url FROM app.user_visits WHERE user_id = ?::uuid)
          AND d2.url IN (SELECT doc_url FROM app.user_visits WHERE user_id = ?::uuid)
        GROUP BY d1.url, d2.url
        HAVING COUNT(*) >= 1
        """,
        (rs, rowNum) -> {
          String srcId = urlToId.get(rs.getString("src_url"));
          String tgtId = urlToId.get(rs.getString("tgt_url"));
          if (srcId == null || tgtId == null) return null;
          Map<String, Object> edge = new HashMap<>();
          edge.put("source", srcId);
          edge.put("target", tgtId);
          edge.put("weight", rs.getInt("weight"));
          return edge;
        },
        userId, userId, userId);

    List<Map<String, Object>> validEdges = new ArrayList<>();
    for (var e : edges) {
      if (e != null) validEdges.add(e);
    }

    int totalQueries = 0;
    try {
      Integer count = jdbc.queryForObject(
          "SELECT COUNT(*) FROM app.queries WHERE user_id = ?::uuid AND status = 'succeeded'",
          Integer.class, userId);
      totalQueries = count != null ? count : 0;
    } catch (Exception ignored) {}

    Map<String, Object> result = new HashMap<>();
    result.put("nodes", nodes);
    result.put("edges", validEdges);
    result.put("totalDocs", nodes.size());
    result.put("totalQueries", totalQueries);
    return result;
  }
}
