package com.awsdocs.adapter.out.persistence;

import com.awsdocs.application.port.out.QueryRepository;
import com.awsdocs.domain.model.QueryResult;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
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
  private final ObjectMapper objectMapper;

  public QueryRepositoryImpl(JdbcTemplate jdbc, ObjectMapper objectMapper) {
    this.jdbc = jdbc;
    this.objectMapper = objectMapper;
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
  public void markRunning(UUID queryId) {
    jdbc.update(
        "update app.queries set status = 'running' where id = ?", queryId);
  }

  @Override
  @Transactional
  public void markSucceeded(UUID queryId, QueryResult result) {
    String answerText = result.answer();
    jdbc.update(
        """
        update app.queries
           set status = 'succeeded',
               answer = ?,
               completed_at = now()
         where id = ?
        """,
        answerText,
        queryId);
  }

  @Override
  @Transactional
  public void markFailed(UUID queryId, String errorCode, String errorMessage) {
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

  private void setRlsUserId(String userId) {
    jdbc.execute("set local \"app.current_user_id\" = '" + userId + "'");
  }

  private QueryResult mapToQueryResult(ResultSet rs) throws SQLException {
    return new QueryResult(
        rs.getString("id"),
        rs.getString("answer"),
        List.of(),
        List.of(),
        Map.of());
  }
}
