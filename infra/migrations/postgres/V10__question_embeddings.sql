CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE app.queries
  ADD COLUMN IF NOT EXISTS question_embedding vector(384);

CREATE INDEX IF NOT EXISTS queries_embedding_idx
  ON app.queries
  USING ivfflat (question_embedding vector_cosine_ops)
  WITH (lists = 10)
  WHERE question_embedding IS NOT NULL;
