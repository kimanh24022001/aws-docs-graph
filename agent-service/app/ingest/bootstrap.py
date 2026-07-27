import asyncio
import uuid

import httpx
from fastapi import APIRouter, HTTPException

from app.db.postgres import get_pool
from app.ingest.page import ingest_one_page
from app.ingest.sitemap import CRAWL_DELAY_SECONDS, fetch_all_sitemap_urls

router = APIRouter()


@router.post("/internal/ingest/bootstrap", status_code=202)
async def run_bootstrap():
    """Uncapped full ingest. Run once to seed the database."""
    pool = await get_pool()

    # Idempotency lock: reject if a run is already in progress
    lock_row = await pool.fetchrow("SELECT last_url FROM app.crawl_cursor WHERE id = 'lock'")
    if lock_row and lock_row["last_url"] == "RUNNING":
        raise HTTPException(status_code=409, detail="Ingest already running")

    await pool.execute(
        "INSERT INTO app.crawl_cursor (id, last_url) VALUES ('lock', 'RUNNING') "
        "ON CONFLICT (id) DO UPDATE SET last_url = 'RUNNING', updated_at = now()"
    )

    run_id = uuid.uuid4()
    processed = 0
    failed = 0
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            urls = await fetch_all_sitemap_urls(client)

        for url in urls:
            try:
                await ingest_one_page(url, run_id, pool)
                processed += 1
                await asyncio.sleep(CRAWL_DELAY_SECONDS)  # rate limit crawl
            except Exception:
                failed += 1
                await pool.execute(
                    "INSERT INTO app.crawl_log (run_id, url, outcome) VALUES ($1, $2, 'failed')",
                    run_id,
                    url,
                )
    finally:
        await pool.execute(
            "UPDATE app.crawl_cursor SET last_url = 'IDLE', updated_at = now() WHERE id = 'lock'"
        )

    return {"run_id": str(run_id), "processed": processed, "failed": failed}
