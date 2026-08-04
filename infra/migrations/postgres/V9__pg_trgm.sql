CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS queries_question_trgm_idx
  ON app.queries USING gin (question gin_trgm_ops)
  WHERE status = 'succeeded';
