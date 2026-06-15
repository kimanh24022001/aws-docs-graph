.PHONY: dev migrate migrate-postgres migrate-neo4j stop clean

dev: ## Start local databases, run all migrations
	docker compose up -d
	@echo "Waiting for databases to be healthy..."
	@until docker compose ps | grep -E "postgres.*healthy" > /dev/null 2>&1; do sleep 1; done
	@until docker compose ps | grep -E "neo4j.*healthy" > /dev/null 2>&1; do sleep 1; done
	$(MAKE) migrate
	@echo ""
	@echo "✅ Local dev ready"
	@echo "   Postgres:  postgresql://postgres:postgres@localhost:5432/postgres"
	@echo "   Neo4j UI:  http://localhost:7474  (neo4j / devpassword)"
	@echo "   Neo4j Bolt: bolt://localhost:7687"

migrate: migrate-postgres migrate-neo4j ## Run all migrations

migrate-postgres: ## Run Flyway Postgres migrations
	docker run --rm \
		--network host \
		-v "$$(pwd)/infra/migrations/postgres:/flyway/sql" \
		flyway/flyway:10 \
		-url=jdbc:postgresql://localhost:5432/postgres \
		-user=postgres \
		-password=postgres \
		-schemas=app \
		migrate

migrate-neo4j: ## Run Neo4j Cypher migrations
	./scripts/neo4j-migrate.sh

stop: ## Stop local databases (keeps data)
	docker compose stop

clean: ## Stop and remove all data volumes (destructive!)
	docker compose down -v
	@echo "All volumes removed."
