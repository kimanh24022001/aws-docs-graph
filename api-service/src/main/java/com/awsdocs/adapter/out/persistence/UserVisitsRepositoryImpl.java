package com.awsdocs.adapter.out.persistence;

import com.awsdocs.application.port.out.UserVisitsRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

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
}
