-- pg_trgm and vector extensions were created in the `app` schema (migrations run with -schemas=app).
-- Add `app` to the database search_path so similarity() and the <=> operator resolve
-- for every connection without schema-qualification.
ALTER DATABASE postgres SET search_path TO "$user", public, app;
