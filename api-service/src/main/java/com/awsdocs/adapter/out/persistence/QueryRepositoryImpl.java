package com.awsdocs.adapter.out.persistence;

import com.awsdocs.application.port.out.QueryRepository;
import com.awsdocs.domain.model.QueryResult;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class QueryRepositoryImpl implements QueryRepository {

  private final JdbcTemplate jdbc;

  public QueryRepositoryImpl(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  @Transactional
  public UUID createPending(String userId, String orgId, String question, String idempotencyKey) {
    setRlsUserId(userId);
    return jdbc.queryForObject(
        """
        insert into app.queries
          (user_id, org_id, question, question_hash, status, idempotency_key)
        values
          (?::uuid, ?::uuid, ?, md5(?), 'pending', ?)
        returning id
        """,
        UUID.class,
        userId,
        orgId,
        question,
        question,
        idempotencyKey);
  }

  @Override
  @Transactional
  public void markRunning(UUID queryId, String userId) {
    setRlsUserId(userId);
    jdbc.update("update app.queries set status = 'running' where id = ?", queryId);
  }

  @Override
  @Transactional
  public void markSucceeded(UUID queryId, String userId, QueryResult result) {
    setRlsUserId(userId);
    jdbc.update(
        """
        update app.queries
           set status = 'succeeded',
               answer = ?,
               completed_at = now()
         where id = ?
        """,
        result.answer(),
        queryId);

    // Persist citations so co-citation edges work in my-learning
    var citations = result.citations();
    if (citations != null) {
      for (int i = 0; i < citations.size(); i++) {
        var c = citations.get(i);
        String url = (String) c.get("url");
        if (url == null || url.isBlank()) continue;
        try {
          // Upsert document row (url is unique)
          UUID docId = jdbc.queryForObject(
              """
              INSERT INTO app.documents (url, url_hash, title, service, hash)
              VALUES (?, md5(?), ?, ?, md5(?))
              ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title
              RETURNING id
              """,
              UUID.class,
              url, url,
              c.get("title") != null ? (String) c.get("title") : "",
              c.get("service") != null ? (String) c.get("service") : "",
              url);

          if (docId != null) {
            jdbc.update(
                """
                INSERT INTO app.query_citations (query_id, document_id, rank, source_kind)
                VALUES (?, ?, ?, 'mcp_search')
                ON CONFLICT DO NOTHING
                """,
                queryId, docId, i + 1);
          }
        } catch (Exception ignored) {}
      }
    }
  }

  @Override
  @Transactional
  public void markFailed(UUID queryId, String userId, String errorCode, String errorMessage) {
    setRlsUserId(userId);
    jdbc.update(
        """
        update app.queries
           set status = 'failed',
               error_code = ?,
               error_message = ?,
               completed_at = now()
         where id = ?
        """,
        errorCode,
        errorMessage,
        queryId);
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<QueryResult> findSimilarQuestion(String userId, String question) {
    setRlsUserId(userId);
    // Trigram fallback only — embedding lookup is done in QueryService before this
    String normalized = question.toLowerCase()
        .replaceAll("could you |please |explain |describe |tell me about |what is |what are |how does |how do ", "")
        .replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    if (normalized.isBlank()) normalized = question;
    final String q = normalized;
    try {
      return Optional.ofNullable(
          jdbc.queryForObject(
              """
              SELECT q.id, q.answer,
                     similarity(lower(q.question), ?::text) AS sim,
                     coalesce(json_agg(
                       json_build_object('url', d.url, 'title', d.title, 'service', d.service)
                       ORDER BY qc.rank
                     ) FILTER (WHERE d.id IS NOT NULL), '[]') AS citations
                FROM app.queries q
                LEFT JOIN app.query_citations qc ON qc.query_id = q.id
                LEFT JOIN app.documents d ON d.id = qc.document_id
               WHERE q.user_id = ?::uuid
                 AND q.status = 'succeeded'
                 AND similarity(lower(q.question), ?::text) > 0.4
               GROUP BY q.id, q.answer
               ORDER BY sim DESC
               LIMIT 1
              """,
              (rs, rowNum) -> mapCachedResult(rs),
              q, userId, q));
    } catch (org.springframework.dao.EmptyResultDataAccessException e) {
      return Optional.empty();
    }
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<QueryResult> findByEmbedding(String userId, String pgVector) {
    setRlsUserId(userId);
    try {
      return Optional.ofNullable(
          jdbc.queryForObject(
              """
              SELECT q.id, q.answer,
                     1 - (q.question_embedding <=> ?::vector) AS sim,
                     coalesce(json_agg(
                       json_build_object('url', d.url, 'title', d.title, 'service', d.service)
                       ORDER BY qc.rank
                     ) FILTER (WHERE d.id IS NOT NULL), '[]') AS citations
                FROM app.queries q
                LEFT JOIN app.query_citations qc ON qc.query_id = q.id
                LEFT JOIN app.documents d ON d.id = qc.document_id
               WHERE q.user_id = ?::uuid
                 AND q.status = 'succeeded'
                 AND q.question_embedding IS NOT NULL
                 AND 1 - (q.question_embedding <=> ?::vector) > 0.85
               GROUP BY q.id, q.answer, q.question_embedding
               ORDER BY q.question_embedding <=> ?::vector
               LIMIT 1
              """,
              (rs, rowNum) -> mapCachedResult(rs),
              pgVector, userId, pgVector, pgVector));
    } catch (org.springframework.dao.EmptyResultDataAccessException e) {
      return Optional.empty();
    }
  }

  @Override
  @Transactional
  public void storeEmbedding(java.util.UUID queryId, java.util.List<Double> embedding) {
    if (embedding == null || embedding.isEmpty()) return;
    String vec = embedding.stream()
        .map(Object::toString)
        .collect(java.util.stream.Collectors.joining(",", "[", "]"));
    jdbc.update(
        "UPDATE app.queries SET question_embedding = ?::vector WHERE id = ?",
        vec, queryId);
  }

  private QueryResult mapCachedResult(java.sql.ResultSet rs) throws java.sql.SQLException {
    var citations = new java.util.ArrayList<java.util.Map<String, Object>>();
    try {
      var json = rs.getString("citations");
      if (json != null && !json.equals("[]")) {
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        citations.addAll(mapper.readValue(json,
            new com.fasterxml.jackson.core.type.TypeReference<
                java.util.List<java.util.Map<String, Object>>>() {}));
      }
    } catch (Exception ignored) {}
    return new QueryResult(rs.getString("id"), rs.getString("answer"),
        citations, java.util.List.of(), java.util.Map.of());
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<QueryResult> findByIdempotencyKey(String userId, String idempotencyKey) {
    setRlsUserId(userId);
    try {
      var result =
          jdbc.queryForObject(
              """
              select id, answer
                from app.queries
               where user_id = ?::uuid
                 and idempotency_key = ?
                 and status = 'succeeded'
              """,
              (rs, rowNum) -> mapToQueryResult(rs),
              userId,
              idempotencyKey);
      return Optional.ofNullable(result);
    } catch (EmptyResultDataAccessException e) {
      return Optional.empty();
    }
  }

  @Override
  @Transactional(readOnly = true)
  public double getDailyLlmCostForUser(String userId) {
    setRlsUserId(userId);
    Double cost =
        jdbc.queryForObject(
            """
            select coalesce(sum(cost_usd), 0)
              from app.llm_calls lc
              join app.queries q on lc.query_id = q.id
             where q.user_id = ?::uuid
               and lc.created_at >= current_date
            """,
            Double.class,
            userId);
    return cost == null ? 0.0 : cost;
  }

  @Override
  @Transactional(readOnly = true)
  public List<Map<String, Object>> listRecent(String userId, int limit) {
    setRlsUserId(userId);
    return jdbc.query(
        """
        SELECT id::text, question, status, created_at, completed_at
        FROM app.queries
        WHERE user_id = ?::uuid
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (rs, rowNum) -> {
          var row = new java.util.HashMap<String, Object>();
          row.put("id", rs.getString("id"));
          row.put("question", rs.getString("question"));
          row.put("status", rs.getString("status"));
          row.put("created_at", rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant().toString() : null);
          var completed = rs.getTimestamp("completed_at");
          row.put("completed_at", completed != null ? completed.toInstant().toString() : null);
          return row;
        },
        userId, limit);
  }

  private void setRlsUserId(String userId) {
    // is_local=true: setting is transaction-scoped, ensuring same connection context
    jdbc.execute(
        (java.sql.Connection conn) -> {
          try (var ps =
              conn.prepareStatement("select set_config('app.current_user_id', ?, true)")) {
            ps.setString(1, userId);
            ps.execute();
          }
          return null;
        });
  }

  private QueryResult mapToQueryResult(ResultSet rs) throws SQLException {
    return new QueryResult(
        rs.getString("id"), rs.getString("answer"), List.of(), List.of(), Map.of());
  }
}
