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
    // Use parameterised set_config() to prevent SQL injection
    jdbc.execute(
        (java.sql.Connection conn) -> {
          try (var ps = conn.prepareStatement("select set_config('app.current_user_id', ?, false)")) {
            ps.setString(1, userId);
            ps.execute();
          }
          return null;
        });
  }

  private QueryResult mapToQueryResult(ResultSet rs) throws SQLException {
    return new QueryResult(rs.getString("id"), rs.getString("answer"), List.of(), List.of(), Map.of());
  }
}
