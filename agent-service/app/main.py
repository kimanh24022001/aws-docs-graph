from contextlib import asynccontextmanager

from fastapi import FastAPI
from mangum import Mangum

from app.db.neo4j import close_driver
from app.db.postgres import close_pool
from app.graph.co_returned import router as co_returned_router
from app.ingest.bootstrap import router as ingest_bootstrap_router
from app.ingest.page import router as ingest_page_router
from app.ingest.sitemap import router as ingest_sitemap_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_pool()
    await close_driver()


app = FastAPI(title="agent-service", lifespan=lifespan)

app.include_router(ingest_page_router)
app.include_router(ingest_sitemap_router)
app.include_router(ingest_bootstrap_router)
app.include_router(co_returned_router)


@app.get("/internal/healthz")
async def healthz():
    return {"status": "ok"}


handler = Mangum(app)
