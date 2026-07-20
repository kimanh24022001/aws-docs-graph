import hashlib
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import asyncpg
from bs4 import BeautifulSoup
from fastapi import APIRouter

from app.db.neo4j import session as neo4j_session
from app.db.postgres import get_pool

router = APIRouter()

AWS_DOCS_PREFIX = "https://docs.aws.amazon.com/"
SERVICE_RE = re.compile(r"https://docs\.aws\.amazon\.com/([^/]+)/")

# Locale segments to skip — non-English docs
LOCALE_RE = re.compile(
    r"^(af_za|ar_ae|bg_bg|cs_cz|da_dk|de_de|el_gr|es_es|es_la|fi_fi|fr_ca|fr_fr"
    r"|he_il|hu_hu|id_id|it_it|ja_jp|ko_kr|ms_my|nl_nl|no_no|pl_pl|pt_br|pt_pt"
    r"|ro_ro|ru_ru|sk_sk|sl_si|sv_se|th_th|tr_tr|uk_ua|vi_vn|zh_cn|zh_tw)$",
    re.IGNORECASE,
)

# Normalize common AWS service URL segments → canonical lowercase name
_SERVICE_ALIASES = {
    "amazons3": "s3",
    "amazonec2": "ec2",
    "amazonecs": "ecs",
    "amazonrds": "rds",
    "amazondynamodb": "dynamodb",
    "amazonsns": "sns",
    "awssimplequeueservice": "sqs",
    "amazoncloudwatch": "cloudwatch",
    "amazonvpc": "vpc",
    "awscloudformation": "cloudformation",
    "amazonroute53": "route53",
    "amazonelasticache": "elasticache",
    "amazonredshift": "redshift",
    "amazonkinesis": "kinesis",
    "amazoncognito": "cognito",
    "awssecretsmanager": "secretsmanager",
    "amazonapigateway": "apigateway",
}


def _normalize_service(raw: str) -> str:
    lower = raw.lower()
    return _SERVICE_ALIASES.get(lower, lower)


def is_english_url(url: str) -> bool:
    """Return False for non-English AWS docs URLs like /ja_jp/, /ko_kr/, etc."""
    path = url.replace(AWS_DOCS_PREFIX, "")
    first_segment = path.split("/")[0]
    return not LOCALE_RE.match(first_segment)


@dataclass
class ParsedPage:
    url: str
    title: str | None
    service: str | None
    guide: str | None
    links: list[str]
    prev_url: str | None
    next_url: str | None
    word_count: int
    hash: str


def parse_page(url: str, html: str) -> ParsedPage:
    soup = BeautifulSoup(html, "lxml")

    # Title: strip " - AWS ..." suffix
    raw_title = soup.title.string if soup.title else None
    title = raw_title.split(" - AWS ")[0].strip() if raw_title else None

    # Service + guide from URL — skip locale segment if present
    url_parts = url.replace(AWS_DOCS_PREFIX, "").split("/")
    # If first segment is a locale (e.g. ja_jp), skip it
    start = 1 if LOCALE_RE.match(url_parts[0]) else 0
    raw_service = url_parts[start] if len(url_parts) > start else None
    service = _normalize_service(raw_service) if raw_service else None
    guide = url_parts[start + 2] if len(url_parts) > start + 2 else None

    # AWS-only links in main content
    main = soup.find(id="main-content") or soup.body or soup
    links = sorted(
        {
            a["href"]
            for a in main.find_all("a", href=True)
            if a["href"].startswith(AWS_DOCS_PREFIX) and a["href"] != url
        }
    )

    # prev / next — handle both <link rel="prev" href="..."> and <div rel="prev"><a href="...">
    prev_tag = soup.find(attrs={"rel": "prev"})
    next_tag = soup.find(attrs={"rel": "next"})
    prev_url = prev_tag.get("href") or (prev_tag.find("a") or {}).get("href") if prev_tag else None
    next_url = next_tag.get("href") or (next_tag.find("a") or {}).get("href") if next_tag else None

    # word count (rough)
    text = main.get_text(separator=" ")
    word_count = len(text.split())

    # content hash
    hash_input = (title or "") + "|" + "|".join(links)
    content_hash = hashlib.sha256(hash_input.encode()).hexdigest()

    return ParsedPage(
        url=url,
        title=title,
        service=service,
        guide=guide,
        links=links,
        prev_url=prev_url,
        next_url=next_url,
        word_count=word_count,
        hash=content_hash,
    )


async def upsert_document(
    pool: asyncpg.Pool, parsed: ParsedPage, run_id: uuid.UUID
) -> tuple[uuid.UUID, str]:
    """Upsert document into Postgres. Returns (document_id, outcome)."""
    url_hash = hashlib.sha256(parsed.url.encode()).hexdigest()
    now = datetime.now(UTC)

    row = await pool.fetchrow(
        "SELECT id, hash, status FROM app.documents WHERE url = $1", parsed.url
    )

    if row is None:
        doc_id = uuid.uuid4()
        await pool.execute(
            """
            INSERT INTO app.documents
              (id, url, url_hash, title, service, guide, word_count, hash,
               first_seen_at, last_crawled_at, last_changed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9)
            """,
            doc_id,
            parsed.url,
            url_hash,
            parsed.title,
            parsed.service,
            parsed.guide,
            parsed.word_count,
            parsed.hash,
            now,
        )
        outcome = "new"
    else:
        doc_id = row["id"]
        changed = row["hash"] != parsed.hash
        # Always reset status to 'active' — handles URLs that were previously 'gone'
        # and have reappeared in the sitemap.
        await pool.execute(
            """
            UPDATE app.documents
            SET title=$2, service=$3, guide=$4, word_count=$5, hash=$6,
                status='active',
                last_crawled_at=$7,
                last_changed_at=CASE WHEN $8 THEN $7 ELSE last_changed_at END
            WHERE id=$1
            """,
            doc_id,
            parsed.title,
            parsed.service,
            parsed.guide,
            parsed.word_count,
            parsed.hash,
            now,
            changed,
        )
        outcome = "updated" if changed else "unchanged"

    # crawl_log
    await pool.execute(
        """
        INSERT INTO app.crawl_log (run_id, url, outcome, document_id)
        VALUES ($1, $2, $3, $4)
        """,
        run_id,
        parsed.url,
        outcome,
        doc_id,
    )

    return doc_id, outcome


async def merge_neo4j(doc_id: uuid.UUID, parsed: ParsedPage) -> None:
    """MERGE Document node + outbound LINKS_TO / PREV_NEXT edges."""
    async with neo4j_session() as s:
        # Merge this document node
        await s.run(
            """
            MERGE (d:Document {id: $id})
            SET d.url = $url, d.title = $title, d.service = $service,
                d.guide = $guide, d.word_count = $word_count,
                d.last_crawled_at = $crawled_at
            """,
            id=str(doc_id),
            url=parsed.url,
            title=parsed.title,
            service=parsed.service,
            guide=parsed.guide,
            word_count=parsed.word_count,
            crawled_at=datetime.now(UTC).isoformat(),
        )

        # LINKS_TO edges (placeholder nodes allowed)
        for link in parsed.links:
            await s.run(
                """
                MERGE (target:Document {url: $url})
                ON CREATE SET target.placeholder = true
                WITH target
                MATCH (src:Document {id: $src_id})
                MERGE (src)-[:LINKS_TO]->(target)
                """,
                url=link,
                src_id=str(doc_id),
            )

        # PREV_NEXT edges
        for direction, neighbor_url in [("prev", parsed.prev_url), ("next", parsed.next_url)]:
            if neighbor_url:
                await s.run(
                    """
                    MERGE (neighbor:Document {url: $url})
                    ON CREATE SET neighbor.placeholder = true
                    WITH neighbor
                    MATCH (src:Document {id: $src_id})
                    MERGE (src)-[:PREV_NEXT {direction: $dir}]->(neighbor)
                    """,
                    url=neighbor_url,
                    src_id=str(doc_id),
                    dir=direction,
                )


@router.post("/internal/ingest/page", status_code=202)
async def ingest_page(url: str, run_id: str | None = None):
    import httpx

    rid = uuid.UUID(run_id) if run_id else uuid.uuid4()
    pool = await get_pool()

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        result = await ingest_one_page(url, rid, pool, client=client)

    return result


async def ingest_one_page(
    url: str,
    run_id: uuid.UUID,
    pool,
    client=None,
) -> dict:
    """Internal helper — parse + upsert + Neo4j. Used by sitemap.py and bootstrap.py.

    Pass a shared httpx.AsyncClient via `client` when calling in bulk to reuse connections.
    """
    import httpx

    if client is not None:
        resp = await client.get(url, headers={"User-Agent": "aws-docs-graph/1.0"})
        resp.raise_for_status()
        parsed = parse_page(url, resp.text)
    else:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as c:
            resp = await c.get(url, headers={"User-Agent": "aws-docs-graph/1.0"})
            resp.raise_for_status()
            parsed = parse_page(url, resp.text)

    doc_id, outcome = await upsert_document(pool, parsed, run_id)
    await merge_neo4j(doc_id, parsed)
    return {"url": url, "document_id": str(doc_id), "outcome": outcome}
