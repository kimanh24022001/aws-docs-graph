import json
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session
from app.db.postgres import get_pool

router = APIRouter()

DECAY_FACTOR = 0.9  # exponential decay applied to existing edge weight each observation
MIN_WEIGHT = 0.05  # edges below this weight are pruned


@router.post("/internal/graph/co-returned", status_code=202)
async def update_co_returned():
    """Read last 24h of mcp_search_log and update CO_RETURNED edge weights."""
    pool = await get_pool()
    since = datetime.now(UTC) - timedelta(hours=24)

    rows = await pool.fetch(
        """
        SELECT result_summary->>'urls' AS urls
        FROM app.mcp_search_log
        WHERE status = 'ok' AND created_at >= $1
          AND result_summary ? 'urls'
        """,
        since,
    )

    # Build co-occurrence counts — url_a < url_b to ensure canonical direction
    pair_counts: dict[tuple[str, str], int] = defaultdict(int)
    for row in rows:
        try:
            urls = json.loads(row["urls"])
            for i, u1 in enumerate(urls):
                for u2 in urls[i + 1 :]:
                    a, b = min(u1, u2), max(u1, u2)
                    pair_counts[(a, b)] += 1
        except Exception:
            pass

    if not pair_counts:
        return {"updated": 0}

    # Update Neo4j CO_RETURNED edges (directed: a -> b, where a = min URL lexicographically)
    updated = 0
    async with neo4j_session() as s:
        for (url_a, url_b), count in pair_counts.items():
            await s.run(
                """
                MATCH (a:Document {url: $url_a}), (b:Document {url: $url_b})
                MERGE (a)-[r:CO_RETURNED]->(b)
                ON CREATE SET r.weight = $weight, r.observation_count = $count,
                              r.last_observed_at = $now
                ON MATCH SET  r.weight = r.weight * $decay + $weight,
                              r.observation_count = r.observation_count + $count,
                              r.last_observed_at = $now
                WITH r
                WHERE r.weight < $min_weight
                DELETE r
                """,
                url_a=url_a,
                url_b=url_b,
                weight=min(count / 10.0, 1.0),
                count=count,
                decay=DECAY_FACTOR,
                min_weight=MIN_WEIGHT,
                now=datetime.now(UTC).isoformat(),
            )
            updated += 1

    return {"updated": updated}
