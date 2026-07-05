import asyncio
from contextlib import asynccontextmanager

from neo4j import AsyncGraphDatabase

from app.config import settings

_driver = None
_driver_lock = asyncio.Lock()


async def get_driver():
    global _driver
    async with _driver_lock:
        if _driver is None:
            _driver = AsyncGraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_username, settings.neo4j_password),
            )
    return _driver


async def close_driver() -> None:
    global _driver
    async with _driver_lock:
        if _driver:
            await _driver.close()
            _driver = None


@asynccontextmanager
async def session():
    driver = await get_driver()
    async with driver.session() as s:
        yield s
