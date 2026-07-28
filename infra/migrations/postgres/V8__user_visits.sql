CREATE TABLE app.user_visits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  doc_url          text NOT NULL,
  doc_title        text,
  service          text,
  visit_count      int NOT NULL DEFAULT 1,
  last_visited_at  timestamptz NOT NULL DEFAULT now(),
  first_visited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, doc_url)
);

CREATE INDEX user_visits_user_idx ON app.user_visits(user_id);
