import uuid

import httpx
from fastapi import APIRouter

from app.db.postgres import get_pool
from app.ingest.page import ingest_one_page
from app.ingest.sitemap import fetch_all_sitemap_urls

router = APIRouter()


@router.post("/internal/ingest/bootstrap", status_code=202)
async def run_bootstrap():
    """Uncapped full ingest. Run once to seed the database."""
    pool = await get_pool()
    run_id = uuid.uuid4()

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        urls = await fetch_all_sitemap_urls(client)

    processed = 0
    failed = 0
    for url in urls:
        try:
            await ingest_one_page(url, run_id, pool)
            processed += 1
        except Exception:
            failed += 1
            await pool.execute(
                "INSERT INTO app.crawl_log (run_id, url, outcome) VALUES ($1, $2, 'failed')",
                run_id,
                url,
            )

    return {"run_id": str(run_id), "processed": processed, "failed": failed}
