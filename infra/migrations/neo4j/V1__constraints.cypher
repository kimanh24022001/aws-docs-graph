CREATE CONSTRAINT document_id_unique IF NOT EXISTS
  FOR (d:Document) REQUIRE d.id IS UNIQUE;

CREATE CONSTRAINT document_url_unique IF NOT EXISTS
  FOR (d:Document) REQUIRE d.url IS UNIQUE;

CREATE INDEX document_service_idx IF NOT EXISTS
  FOR (d:Document) ON (d.service);

CREATE INDEX document_title_idx IF NOT EXISTS
  FOR (d:Document) ON (d.title);
