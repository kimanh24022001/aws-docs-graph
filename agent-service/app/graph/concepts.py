import hashlib
import uuid
from datetime import UTC, datetime

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session
from app.db.postgres import get_pool

router = APIRouter()

BATCH_LIMIT = 200


def extract_headings(html: str) -> list[tuple[str, int]]:
    """Extract (text, level) tuples from H1/H2/H3 tags in main content."""
    soup = BeautifulSoup(html, "lxml")
    main = soup.find(id="main-content") or soup.body or soup
    headings = []
    seen = set()
    for tag in main.find_all(["h1", "h2", "h3"]):
        text = tag.get_text(strip=True)
        level = int(tag.name[1])
        if text and text not in seen:
            seen.add(text)
            headings.append((text, level))
    return headings


def build_concept_nodes(doc_id: str, service: str, headings: list[tuple[str, int]]) -> list[dict]:
    """Build concept node dicts from heading tuples."""
    seen = set()
    nodes = []
    for name, level in headings:
        if name in seen:
            continue
        seen.add(name)
        # Deterministic ID: hash of doc_id + name so re-runs are idempotent
        concept_id = str(uuid.UUID(hashlib.md5(f"{doc_id}:{name}".encode()).hexdigest()))
        nodes.append(
            {
                "id": concept_id,
                "name": name,
                "service": service,
                "source_doc_id": doc_id,
                "level": level,
            }
        )
    return nodes


@router.post("/internal/graph/extract-concepts", status_code=202)
async def extract_concepts():
    """Parse H1/H2/H3 from un-processed docs and create :Concept nodes in Neo4j."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, url, service FROM app.documents "
        "WHERE extracted_concepts_at IS NULL AND status = 'active' "
        "LIMIT $1",
        BATCH_LIMIT,
    )

    docs_processed = 0
    concepts_created = 0

    async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
        for row in rows:
            try:
                resp = await client.get(row["url"], headers={"User-Agent": "aws-docs-graph/1.0"})
                resp.raise_for_status()
                headings = extract_headings(resp.text)
                concept_nodes = build_concept_nodes(row["id"], row["service"] or "", headings)

                if concept_nodes:
                    async with neo4j_session() as s:
                        # MERGE concept nodes
                        await s.run(
                            "UNWIND $nodes AS n "
                            "MERGE (c:Concept {id: n.id}) "
                            "SET c.name = n.name, c.service = n.service, "
                            "    c.source_doc_id = n.source_doc_id, "
                            "    c.level = n.level "
                            "WITH c, n "
                            "MATCH (d:Document {id: n.source_doc_id}) "
                            "MERGE (d)-[:CONTAINS_CONCEPT]->(c)",
                            nodes=concept_nodes,
                        )
                        concepts_created += len(concept_nodes)

                # Mark doc as processed
                await pool.execute(
                    "UPDATE app.documents SET extracted_concepts_at = $1 WHERE id = $2",
                    datetime.now(UTC),
                    row["id"],
                )
                docs_processed += 1
            except Exception:
                pass  # skip failed docs, they will retry next run

    return {"docs_processed": docs_processed, "concepts_created": concepts_created}
