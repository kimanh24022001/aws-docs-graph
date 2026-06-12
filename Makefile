.PHONY: dev test lint migrate

dev:
	docker compose up -d
	$(MAKE) migrate
	@echo "Local dev running. Postgres: localhost:5432  Neo4j: localhost:7474"

migrate:
	@echo "Run flyway migrate (implemented Day 2)"

test:
	@echo "Run all tests (implemented per service)"

lint:
	@echo "Run all linters (implemented per service)"
