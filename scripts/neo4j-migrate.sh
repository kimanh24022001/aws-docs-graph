#!/usr/bin/env bash
set -euo pipefail

NEO4J_URI="${NEO4J_URI:-bolt://localhost:7687}"
NEO4J_USERNAME="${NEO4J_USERNAME:-neo4j}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-devpassword}"
MIGRATIONS_DIR="$(dirname "$0")/../infra/migrations/neo4j"

echo "Applying Neo4j migrations from $MIGRATIONS_DIR..."

for f in "$MIGRATIONS_DIR"/*.cypher; do
  echo "  → $(basename "$f")"
  docker exec -i "$(docker compose ps -q neo4j)" \
    cypher-shell -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" \
    < "$f"
done

echo "Neo4j migrations done."
