import asyncio
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio
from testcontainers.neo4j import Neo4jContainer
from testcontainers.postgres import PostgresContainer


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def postgres_container():
    with PostgresContainer("postgres:16", driver=None) as pg:
        yield pg


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def pg_pool(postgres_container):
    url = postgres_container.get_connection_url()
    pool = await asyncpg.create_pool(url, min_size=1, max_size=5)

    # Run Flyway-style migrations in order
    migrations_dir = Path(__file__).parent.parent.parent / "infra/migrations/postgres"
    migration_files = sorted(migrations_dir.glob("V*.sql"))
    async with pool.acquire() as conn:
        for f in migration_files:
            await conn.execute(f.read_text())

    yield pool
    await pool.close()


@pytest.fixture(scope="session")
def neo4j_container():
    with Neo4jContainer("neo4j:5", password="devpassword") as neo4j:
        yield neo4j


@pytest.fixture(scope="session")
def neo4j_uri(neo4j_container):
    return neo4j_container.get_connection_url()
