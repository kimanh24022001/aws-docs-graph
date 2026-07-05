import hashlib
import uuid

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter

from app.db.postgres import get_pool
from app.ingest.page import ingest_one_page

router = APIRouter()

AWS_SITEMAP_INDEX = "https://docs.aws.amazon.com/sitemap_index.xml"
PER_RUN_CAP = 2000


def diff_urls(sitemap_urls: set[str], existing_hashes: dict[str, str]) -> tuple[set[str], set[str]]:
    """Return (new_urls, gone_urls) by comparing sitemap against known url_hashes."""
    sitemap_hashes = {hashlib.sha256(u.encode()).hexdigest(): u for u in sitemap_urls}
    new_urls = {u for h, u in sitemap_hashes.items() if h not in existing_hashes}
    gone_urls = {u for h, u in existing_hashes.items() if h not in sitemap_hashes}
    return new_urls, gone_urls


async def fetch_all_sitemap_urls(client: httpx.AsyncClient) -> set[str]:
    resp = await client.get(AWS_SITEMAP_INDEX)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml-xml")
    sub_sitemaps = [loc.text for loc in soup.find_all("loc")]

    all_urls: set[str] = set()
    for sm_url in sub_sitemaps:
        try:
            r = await client.get(sm_url)
            r.raise_for_status()
            sm_soup = BeautifulSoup(r.text, "lxml-xml")
            all_urls.update(loc.text for loc in sm_soup.find_all("loc"))
        except Exception:
            pass  # skip broken sub-sitemaps

    return all_urls


@router.post("/internal/ingest/sitemap", status_code=202)
async def run_sitemap_ingest():
    pool = await get_pool()
    run_id = uuid.uuid4()

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        sitemap_urls = await fetch_all_sitemap_urls(client)

        # Load existing url_hashes from Postgres
        rows = await pool.fetch("SELECT url_hash, url FROM app.documents WHERE status = 'active'")
        existing_hashes = {row["url_hash"]: row["url"] for row in rows}

        new_urls, gone_urls = diff_urls(sitemap_urls, existing_hashes)

        # Mark gone
        if gone_urls:
            await pool.execute(
                "UPDATE app.documents SET status = 'gone' WHERE url = ANY($1::text[])",
                list(gone_urls),
            )

        # Build work queue: new URLs first, then existing (re-crawl for change detection)
        existing_urls = set(existing_hashes.values()) - gone_urls
        all_work = list(new_urls) + list(existing_urls)

        # Resume from cursor if present — skip URLs already processed in a prior run
        cursor_row = await pool.fetchrow("SELECT last_url FROM app.crawl_cursor WHERE id = 'main'")
        if cursor_row and cursor_row["last_url"] in all_work:
            resume_idx = all_work.index(cursor_row["last_url"])
            all_work = all_work[resume_idx:]

        work_queue = all_work[:PER_RUN_CAP]
        remaining = all_work[PER_RUN_CAP:]

        # Checkpoint the first URL of the next batch (None if done)
        next_cursor = remaining[0] if remaining else None
        await pool.execute(
            "INSERT INTO app.crawl_cursor (id, last_url) VALUES ('main', $1) "
            "ON CONFLICT (id) DO UPDATE SET last_url = $1, updated_at = now()",
            next_cursor,
        )

        # Ingest each URL using the shared client
        processed = 0
        for url in work_queue:
            try:
                await ingest_one_page(url, run_id, pool, client=client)
                processed += 1
            except Exception:
                await pool.execute(
                    "INSERT INTO app.crawl_log (run_id, url, outcome) VALUES ($1, $2, 'failed')",
                    run_id,
                    url,
                )

    return {"run_id": str(run_id), "processed": processed, "gone": len(gone_urls)}
