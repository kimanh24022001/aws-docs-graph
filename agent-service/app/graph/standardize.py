"""One-shot idempotent migration: standardize service names in Postgres + Neo4j."""

import logging

from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session
from app.db.postgres import get_pool

logger = logging.getLogger(__name__)
router = APIRouter()

# Old name → canonical name. All values must be lowercase.
CANONICAL_MAP: dict[str, str] = {
    "awsec2": "ec2",
    "sdkfornet": "sdk",
    "awsjavasdk": "sdk",
    "aws-sdk-php": "sdk",
    "awssdkforphp": "sdk",
    "embedded-csdk": "sdk",
    "freertos": "sdk",
    "code-library": "sdk",
    "appstudio": "sdk",
    "aws-sdk-go": "sdk",
    "aws-sdk-pandas": "sdk",
}


@router.post("/internal/graph/standardize-entities", status_code=202)
async def standardize_entities() -> dict:
    """Batch-update service names in Postgres and Neo4j to canonical form.

    Idempotent: safe to call multiple times.
    """
    pool = await get_pool()
    postgres_updated = 0
    neo4j_updated = 0

    for old_name, canonical in CANONICAL_MAP.items():
        # Postgres
        result = await pool.execute(
            "UPDATE app.documents SET service = $1 WHERE service = $2",
            canonical,
            old_name,
        )
        # result is e.g. "UPDATE 733" — parse the count
        try:
            pg_count = int(result.split()[-1])
            postgres_updated += pg_count
        except (ValueError, IndexError):
            logger.debug("Could not parse postgres result for %s: %r", old_name, result)
            pg_count = 0

        # Neo4j
        neo4j_count = 0
        async with neo4j_session() as s:
            cypher_result = await s.run(
                "MATCH (d:Document {service: $old}) SET d.service = $new RETURN count(d) AS cnt",
                old=old_name,
                new=canonical,
            )
            data = await cypher_result.data()
            if data:
                neo4j_count = data[0].get("cnt", 0)
                neo4j_updated += neo4j_count

        if pg_count or neo4j_count:
            logger.info(
                "Standardized %s → %s (pg=%d, neo4j=%d)", old_name, canonical, pg_count, neo4j_count
            )

    return {"postgres_updated": postgres_updated, "neo4j_updated": neo4j_updated}
