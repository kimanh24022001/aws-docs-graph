CREATE CONSTRAINT concept_id_unique IF NOT EXISTS
  FOR (c:Concept) REQUIRE c.id IS UNIQUE;

CREATE INDEX concept_service_idx IF NOT EXISTS
  FOR (c:Concept) ON (c.service);

CREATE INDEX document_community_idx IF NOT EXISTS
  FOR (d:Document) ON (d.community_id);
