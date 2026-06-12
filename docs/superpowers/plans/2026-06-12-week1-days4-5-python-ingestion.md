# Week 1 Days 4–5 — Python Ingestion Pipeline + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python ingestion pipeline (FastAPI + LangGraph-free ingest endpoints), deploy it to Lambda, run the bootstrap ingest to load ≥500 AWS docs into prod Postgres + Neo4j, and wire CI so every push runs lint + tests.

**Architecture:** FastAPI app packaged as a Docker container running on Lambda. Ingest logic is pure Python — BeautifulSoup for HTML parsing, asyncpg for Postgres, neo4j-driver for graph writes. Each endpoint is idempotent: Postgres uses `ON CONFLICT`, Neo4j uses `MERGE`. The sitemap walk checkpoints progress in `app.crawl_cursor` so it survives Lambda timeouts.

**Tech Stack:** Python 3.12, FastAPI, asyncpg, neo4j-driver, httpx, BeautifulSoup4, Hypothesis, pytest, pytest-asyncio, Testcontainers, Docker, GitHub Actions

---

## File Structure

```
agent-service/
├── app/
│   ├── main.py                  FastAPI app, route registration, lifespan
│   ├── config.py                Settings (from env vars / Parameter Store)
│   ├── db/
│   │   ├── postgres.py          asyncpg pool factory + helpers
│   │   └── neo4j.py             neo4j-driver session factory
│   ├── ingest/
│   │   ├── page.py              ingest_one_page() — parse + Postgres upsert + Neo4j MERGE
│   │   ├── sitemap.py           sitemap walk, diff, cap, crawl_cursor checkpoint
│   │   └── bootstrap.py        uncapped chained invocation
│   └── graph/
│       └── co_returned.py       CO_RETURNED edge maintenance
├── tests/
│   ├── conftest.py              Testcontainers fixtures (Postgres + Neo4j)
│   ├── unit/
│   │   ├── test_page_parsing.py HTML parse logic
│   │   ├── test_hash.py         hash stability
│   │   └── test_cypher.py       Cypher MERGE string generation
│   └── integration/
│       ├── test_ingest_page.py  happy path + idempotency + gone URL
│       └── test_sitemap.py      diff logic + cap + cursor
├── Dockerfile
├── requirements.txt
└── pyproject.toml               ruff + pytest config
```

---

### Task 1: Project scaffold + dependencies

- [ ] **Step 1: Create `pyproject.toml`**

  Create `agent-service/pyproject.toml`:
  ```toml
  [tool.ruff]
  line-length = 100
  target-version = "py312"
  select = ["E", "F", "I", "UP"]

  [tool.pytest.ini_options]
  asyncio_mode = "auto"
  testpaths = ["tests"]
  ```

- [ ] **Step 2: Create `requirements.txt`**

  Create `agent-service/requirements.txt`:
  ```
  fastapi==0.111.0
  mangum==0.17.0
  uvicorn[standard]==0.29.0
  asyncpg==0.29.0
  neo4j==5.20.0
  httpx==0.27.0
  beautifulsoup4==4.12.3
  lxml==5.2.2
  pydantic-settings==2.2.1
  boto3==1.34.100
  ```

  Create `agent-service/requirements-dev.txt`:
  ```
  pytest==8.2.0
  pytest-asyncio==0.23.7
  pytest-httpx==0.30.0
  testcontainers[postgres,neo4j]==4.5.1
  hypothesis==6.100.0
  ruff==0.4.4
  ```

- [ ] **Step 3: Create `Dockerfile`**

  Create `agent-service/Dockerfile`:
  ```dockerfile
  FROM public.ecr.aws/lambda/python:3.12

  COPY requirements.txt .
  RUN pip install --no-cache-dir -r requirements.txt

  COPY app/ ${LAMBDA_TASK_ROOT}/app/

  CMD ["app.main.handler"]
  ```

- [ ] **Step 4: Verify Docker build**

  ```bash
  cd agent-service
  docker build -t agent-service-test .
  ```

  Expected: `Successfully built <id>`

- [ ] **Step 5: Commit scaffold**

  ```bash
  git add agent-service/
  git commit -m "chore: scaffold agent-service Python project"
  ```

---

### Task 2: Config + DB connections

- [ ] **Step 1: Create `app/config.py`**

  Create `agent-service/app/config.py`:
  ```python
  from pydantic_settings import BaseSettings


  class Settings(BaseSettings):
      database_url: str = "postgresql://postgres:postgres@localhost:5432/postgres"
      neo4j_uri: str = "bolt://localhost:7687"
      neo4j_username: str = "neo4j"
      neo4j_password: str = "devpassword"
      anthropic_api_key: str = ""
      environment: str = "local"

      class Config:
          env_file = ".env"


  settings = Settings()
  ```

- [ ] **Step 2: Create `app/db/postgres.py`**

  Create `agent-service/app/db/postgres.py`:
  ```python
  import asyncpg

  from app.config import settings

  _pool: asyncpg.Pool | None = None


  async def get_pool() -> asyncpg.Pool:
      global _pool
      if _pool is None:
          _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=5)
      return _pool


  async def close_pool() -> None:
      global _pool
      if _pool:
          await _pool.close()
          _pool = None
  ```

- [ ] **Step 3: Create `app/db/neo4j.py`**

  Create `agent-service/app/db/neo4j.py`:
  ```python
  from contextlib import asynccontextmanager

  from neo4j import AsyncGraphDatabase

  from app.config import settings

  _driver = None


  def get_driver():
      global _driver
      if _driver is None:
          _driver = AsyncGraphDatabase.driver(
              settings.neo4j_uri,
              auth=(settings.neo4j_username, settings.neo4j_password),
          )
      return _driver


  async def close_driver() -> None:
      global _driver
      if _driver:
          await _driver.close()
          _driver = None


  @asynccontextmanager
  async def session():
      async with get_driver().session() as s:
          yield s
  ```

- [ ] **Step 4: Create `app/main.py`**

  Create `agent-service/app/main.py`:
  ```python
  from contextlib import asynccontextmanager

  from fastapi import FastAPI
  from mangum import Mangum

  from app.db.neo4j import close_driver
  from app.db.postgres import close_pool
  from app.ingest.page import router as ingest_page_router
  from app.ingest.sitemap import router as ingest_sitemap_router
  from app.ingest.bootstrap import router as ingest_bootstrap_router
  from app.graph.co_returned import router as co_returned_router


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
  ```

---

### Task 3: Page ingest — unit tests first

- [ ] **Step 1: Write failing unit tests for HTML parsing**

  Create `agent-service/tests/unit/test_page_parsing.py`:
  ```python
  import pytest
  from app.ingest.page import parse_page


  AWS_SAMPLE_HTML = """
  <html>
  <head><title>Using IAM roles - AWS Identity and Access Management</title></head>
  <body>
    <div id="main-content">
      <h1>Using IAM roles</h1>
      <p>You can use IAM roles to delegate access. See also
        <a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create.html">Creating roles</a>
        and <a href="https://docs.aws.amazon.com/STS/latest/APIReference/welcome.html">STS</a>.
        External link: <a href="https://example.com/external">external</a>.
      </p>
    </div>
    <div rel="prev"><a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html">Previous</a></div>
    <div rel="next"><a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_manage.html">Next</a></div>
  </body>
  </html>
  """


  def test_parse_extracts_title():
      result = parse_page("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML)
      assert result.title == "Using IAM roles"


  def test_parse_extracts_service_from_url():
      result = parse_page("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML)
      assert result.service == "IAM"


  def test_parse_extracts_guide_from_url():
      result = parse_page("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML)
      assert result.guide == "UserGuide"


  def test_parse_extracts_aws_links_only():
      result = parse_page("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML)
      assert "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create.html" in result.links
      assert "https://docs.aws.amazon.com/STS/latest/APIReference/welcome.html" in result.links
      assert "https://example.com/external" not in result.links


  def test_parse_extracts_prev_next():
      result = parse_page("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML)
      assert result.prev_url == "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html"
      assert result.next_url == "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_manage.html"


  def test_parse_produces_stable_hash():
      result1 = parse_page("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML)
      result2 = parse_page("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML)
      assert result1.hash == result2.hash


  def test_parse_hash_changes_on_title_change():
      html_changed = AWS_SAMPLE_HTML.replace("Using IAM roles", "Using IAM roles UPDATED")
      result1 = parse_page("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", AWS_SAMPLE_HTML)
      result2 = parse_page("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html", html_changed)
      assert result1.hash != result2.hash
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  cd agent-service
  pip install -r requirements-dev.txt
  pytest tests/unit/test_page_parsing.py -v
  ```

  Expected: `ERRORS` — `app.ingest.page` does not exist yet.

- [ ] **Step 3: Implement `app/ingest/page.py`**

  Create `agent-service/app/ingest/page.py`:
  ```python
  import hashlib
  import re
  import uuid
  from dataclasses import dataclass, field
  from datetime import datetime, timezone

  import asyncpg
  from bs4 import BeautifulSoup
  from fastapi import APIRouter

  from app.db.neo4j import session as neo4j_session
  from app.db.postgres import get_pool

  router = APIRouter()

  AWS_DOCS_PREFIX = "https://docs.aws.amazon.com/"
  SERVICE_RE = re.compile(r"https://docs\.aws\.amazon\.com/([^/]+)/")


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

      # Service + guide from URL
      service_match = SERVICE_RE.match(url)
      service = service_match.group(1).upper() if service_match else None
      url_parts = url.replace(AWS_DOCS_PREFIX, "").split("/")
      guide = url_parts[1] if len(url_parts) > 1 else None

      # AWS-only links in main content
      main = soup.find(id="main-content") or soup.body or soup
      links = sorted({
          a["href"] for a in main.find_all("a", href=True)
          if a["href"].startswith(AWS_DOCS_PREFIX) and a["href"] != url
      })

      # prev / next
      prev_tag = soup.find(attrs={"rel": "prev"})
      next_tag = soup.find(attrs={"rel": "next"})
      prev_url = prev_tag.find("a")["href"] if prev_tag and prev_tag.find("a") else None
      next_url = next_tag.find("a")["href"] if next_tag and next_tag.find("a") else None

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


  async def upsert_document(pool: asyncpg.Pool, parsed: ParsedPage, run_id: uuid.UUID) -> tuple[uuid.UUID, str]:
      """Upsert document into Postgres. Returns (document_id, outcome)."""
      url_hash = hashlib.sha256(parsed.url.encode()).hexdigest()
      now = datetime.now(timezone.utc)

      row = await pool.fetchrow(
          "SELECT id, hash FROM app.documents WHERE url = $1", parsed.url
      )

      if row is None:
          doc_id = uuid.uuid4()
          await pool.execute(
              """
              INSERT INTO app.documents
                (id, url, url_hash, title, service, guide, word_count, hash, first_seen_at, last_crawled_at, last_changed_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9)
              """,
              doc_id, parsed.url, url_hash, parsed.title, parsed.service,
              parsed.guide, parsed.word_count, parsed.hash, now,
          )
          outcome = "new"
      else:
          doc_id = row["id"]
          changed = row["hash"] != parsed.hash
          await pool.execute(
              """
              UPDATE app.documents
              SET title=$2, service=$3, guide=$4, word_count=$5, hash=$6,
                  last_crawled_at=$7, last_changed_at=CASE WHEN $8 THEN $7 ELSE last_changed_at END
              WHERE id=$1
              """,
              doc_id, parsed.title, parsed.service, parsed.guide,
              parsed.word_count, parsed.hash, now, changed,
          )
          outcome = "updated" if changed else "unchanged"

      # crawl_log
      await pool.execute(
          """
          INSERT INTO app.crawl_log (run_id, url, outcome, document_id)
          VALUES ($1, $2, $3, $4)
          """,
          run_id, parsed.url, outcome, doc_id,
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
              id=str(doc_id), url=parsed.url, title=parsed.title,
              service=parsed.service, guide=parsed.guide,
              word_count=parsed.word_count,
              crawled_at=datetime.now(timezone.utc).isoformat(),
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
                  url=link, src_id=str(doc_id),
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
                      url=neighbor_url, src_id=str(doc_id), dir=direction,
                  )


  @router.post("/internal/ingest/page", status_code=202)
  async def ingest_page(url: str, run_id: str | None = None):
      import httpx
      rid = uuid.UUID(run_id) if run_id else uuid.uuid4()
      pool = await get_pool()

      async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
          resp = await client.get(url, headers={"User-Agent": "aws-docs-graph/1.0"})
          resp.raise_for_status()

      parsed = parse_page(url, resp.text)
      doc_id, outcome = await upsert_document(pool, parsed, rid)
      await merge_neo4j(doc_id, parsed)

      return {"url": url, "document_id": str(doc_id), "outcome": outcome}
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  pytest tests/unit/test_page_parsing.py -v
  ```

  Expected:
  ```
  tests/unit/test_page_parsing.py::test_parse_extracts_title PASSED
  tests/unit/test_page_parsing.py::test_parse_extracts_service_from_url PASSED
  tests/unit/test_page_parsing.py::test_parse_extracts_guide_from_url PASSED
  tests/unit/test_page_parsing.py::test_parse_extracts_aws_links_only PASSED
  tests/unit/test_page_parsing.py::test_parse_extracts_prev_next PASSED
  tests/unit/test_page_parsing.py::test_parse_produces_stable_hash PASSED
  tests/unit/test_page_parsing.py::test_parse_hash_changes_on_title_change PASSED
  7 passed
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add agent-service/
  git commit -m "feat: add page ingest — parse + Postgres upsert + Neo4j MERGE"
  ```

---

### Task 4: Page ingest — integration tests

- [ ] **Step 1: Create Testcontainers fixtures**

  Create `agent-service/tests/conftest.py`:
  ```python
  import asyncio
  import pytest
  import asyncpg
  from testcontainers.postgres import PostgresContainer
  from testcontainers.neo4j import Neo4jContainer
  from pathlib import Path


  @pytest.fixture(scope="session")
  def event_loop():
      loop = asyncio.new_event_loop()
      yield loop
      loop.close()


  @pytest.fixture(scope="session")
  def postgres_container():
      with PostgresContainer("postgres:16") as pg:
          yield pg


  @pytest.fixture(scope="session")
  async def pg_pool(postgres_container):
      pool = await asyncpg.create_pool(postgres_container.get_connection_url().replace("psycopg2", ""))
      # Run Flyway migrations
      migrations_dir = Path(__file__).parent.parent.parent / "infra/migrations/postgres"
      migration_files = sorted(migrations_dir.glob("V*.sql"))
      async with pool.acquire() as conn:
          await conn.execute("CREATE SCHEMA IF NOT EXISTS app")
          for f in migration_files:
              await conn.execute(f.read_text())
      yield pool
      await pool.close()


  @pytest.fixture(scope="session")
  def neo4j_container():
      with Neo4jContainer("neo4j:5") as neo4j:
          neo4j.with_env("NEO4J_AUTH", "neo4j/devpassword")
          yield neo4j


  @pytest.fixture(scope="session")
  def neo4j_uri(neo4j_container):
      return neo4j_container.get_connection_url()
  ```

- [ ] **Step 2: Write integration tests**

  Create `agent-service/tests/integration/test_ingest_page.py`:
  ```python
  import uuid
  import pytest
  from unittest.mock import AsyncMock, patch

  from app.ingest.page import parse_page, upsert_document, merge_neo4j


  SAMPLE_HTML = """
  <html><head><title>S3 buckets - Amazon S3</title></head>
  <body><div id="main-content">
    <p>Learn about <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/creating-buckets-s3.html">creating buckets</a>.</p>
  </div></body></html>
  """
  SAMPLE_URL = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingBucket.html"


  @pytest.mark.asyncio
  async def test_upsert_creates_new_document(pg_pool):
      parsed = parse_page(SAMPLE_URL, SAMPLE_HTML)
      run_id = uuid.uuid4()
      doc_id, outcome = await upsert_document(pg_pool, parsed, run_id)

      assert outcome == "new"
      row = await pg_pool.fetchrow("SELECT url, service FROM app.documents WHERE id = $1", doc_id)
      assert row["url"] == SAMPLE_URL
      assert row["service"] == "AMAZONS3"


  @pytest.mark.asyncio
  async def test_upsert_idempotent_unchanged(pg_pool):
      parsed = parse_page(SAMPLE_URL, SAMPLE_HTML)
      run_id = uuid.uuid4()
      doc_id, _ = await upsert_document(pg_pool, parsed, run_id)

      # Second call with same content
      doc_id2, outcome2 = await upsert_document(pg_pool, parsed, uuid.uuid4())
      assert doc_id == doc_id2
      assert outcome2 == "unchanged"


  @pytest.mark.asyncio
  async def test_upsert_detects_change(pg_pool):
      url = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/ChangeTest.html"
      html_v1 = SAMPLE_HTML.replace("S3 buckets", "S3 buckets v1").replace(SAMPLE_URL, url)
      html_v2 = SAMPLE_HTML.replace("S3 buckets", "S3 buckets v2").replace(SAMPLE_URL, url)

      parsed_v1 = parse_page(url, html_v1)
      parsed_v2 = parse_page(url, html_v2)

      await upsert_document(pg_pool, parsed_v1, uuid.uuid4())
      _, outcome = await upsert_document(pg_pool, parsed_v2, uuid.uuid4())
      assert outcome == "updated"


  @pytest.mark.asyncio
  async def test_crawl_log_written(pg_pool):
      url = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/CrawlLog.html"
      html = SAMPLE_HTML.replace(SAMPLE_URL, url)
      parsed = parse_page(url, html)
      run_id = uuid.uuid4()
      await upsert_document(pg_pool, parsed, run_id)

      row = await pg_pool.fetchrow(
          "SELECT outcome FROM app.crawl_log WHERE url = $1 AND run_id = $2", url, run_id
      )
      assert row is not None
      assert row["outcome"] == "new"
  ```

- [ ] **Step 3: Run integration tests**

  ```bash
  pytest tests/integration/test_ingest_page.py -v
  ```

  Expected: 4 tests pass. (Testcontainers will pull Docker images on first run — takes ~1 min.)

- [ ] **Step 4: Commit**

  ```bash
  git add tests/
  git commit -m "test: add page ingest integration tests (Testcontainers)"
  ```

---

### Task 5: Sitemap ingest

- [ ] **Step 1: Write unit test for sitemap diff logic**

  Create `agent-service/tests/unit/test_sitemap_diff.py`:
  ```python
  from app.ingest.sitemap import diff_urls


  def test_diff_identifies_new_urls():
      sitemap_urls = {"https://docs.aws.amazon.com/a", "https://docs.aws.amazon.com/b"}
      existing_hashes = {}  # url_hash -> url, empty = no existing docs
      new_urls, gone_urls = diff_urls(sitemap_urls, existing_hashes)
      assert sitemap_urls == new_urls
      assert gone_urls == set()


  def test_diff_identifies_gone_urls():
      import hashlib
      old_url = "https://docs.aws.amazon.com/old"
      old_hash = hashlib.sha256(old_url.encode()).hexdigest()
      sitemap_urls = {"https://docs.aws.amazon.com/new"}
      existing_hashes = {old_hash: old_url}
      new_urls, gone_urls = diff_urls(sitemap_urls, existing_hashes)
      assert old_url in gone_urls
      assert old_url not in new_urls


  def test_diff_existing_url_not_new():
      import hashlib
      url = "https://docs.aws.amazon.com/existing"
      url_hash = hashlib.sha256(url.encode()).hexdigest()
      sitemap_urls = {url}
      existing_hashes = {url_hash: url}
      new_urls, gone_urls = diff_urls(sitemap_urls, existing_hashes)
      assert url not in new_urls
      assert url not in gone_urls
  ```

- [ ] **Step 2: Run — expect FAIL**

  ```bash
  pytest tests/unit/test_sitemap_diff.py -v
  ```
  Expected: `ERROR` — `app.ingest.sitemap` not defined.

- [ ] **Step 3: Implement `app/ingest/sitemap.py`**

  Create `agent-service/app/ingest/sitemap.py`:
  ```python
  import hashlib
  import uuid
  from datetime import datetime, timezone

  import httpx
  from bs4 import BeautifulSoup
  from fastapi import APIRouter

  from app.db.postgres import get_pool
  from app.ingest.page import ingest_one_page

  router = APIRouter()

  AWS_SITEMAP_INDEX = "https://docs.aws.amazon.com/sitemap_index.xml"
  PER_RUN_CAP = 2000


  def diff_urls(
      sitemap_urls: set[str], existing_hashes: dict[str, str]
  ) -> tuple[set[str], set[str]]:
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

      # Apply per-run cap: new first, then existing (re-crawl for change detection)
      existing_urls = set(existing_hashes.values()) - gone_urls
      work_queue = list(new_urls) + list(existing_urls)
      work_queue = work_queue[:PER_RUN_CAP]

      # Checkpoint remaining
      remaining = work_queue[PER_RUN_CAP:]
      if remaining:
          await pool.execute(
              "INSERT INTO app.crawl_cursor (id, last_url) VALUES ('main', $1) "
              "ON CONFLICT (id) DO UPDATE SET last_url = $1, updated_at = now()",
              remaining[0],
          )

      # Ingest each URL
      processed = 0
      for url in work_queue:
          try:
              await ingest_one_page(url, run_id, pool)
              processed += 1
          except Exception:
              await pool.execute(
                  "INSERT INTO app.crawl_log (run_id, url, outcome) VALUES ($1, $2, 'failed')",
                  run_id, url,
              )

      return {"run_id": str(run_id), "processed": processed, "gone": len(gone_urls)}
  ```

  Note: `ingest_one_page` is a helper extracted from the page endpoint. Update `page.py` to expose it:

  Add to end of `agent-service/app/ingest/page.py`:
  ```python
  async def ingest_one_page(url: str, run_id: uuid.UUID, pool) -> dict:
      """Internal helper — parse + upsert + Neo4j. Used by sitemap.py."""
      import httpx
      async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
          resp = await client.get(url, headers={"User-Agent": "aws-docs-graph/1.0"})
          resp.raise_for_status()
      parsed = parse_page(url, resp.text)
      doc_id, outcome = await upsert_document(pool, parsed, run_id)
      await merge_neo4j(doc_id, parsed)
      return {"url": url, "document_id": str(doc_id), "outcome": outcome}
  ```

- [ ] **Step 4: Run unit tests**

  ```bash
  pytest tests/unit/test_sitemap_diff.py -v
  ```

  Expected: 3 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add agent-service/app/ingest/
  git commit -m "feat: add sitemap ingest with diff, cap, and crawl_cursor checkpoint"
  ```

---

### Task 6: Bootstrap + co-returned endpoints

- [ ] **Step 1: Create `app/ingest/bootstrap.py`**

  Create `agent-service/app/ingest/bootstrap.py`:
  ```python
  import uuid
  from fastapi import APIRouter
  from app.db.postgres import get_pool
  from app.ingest.page import ingest_one_page
  from app.ingest.sitemap import fetch_all_sitemap_urls
  import httpx

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
                  run_id, url,
              )

      return {"run_id": str(run_id), "processed": processed, "failed": failed}
  ```

- [ ] **Step 2: Create `app/graph/co_returned.py`**

  Create `agent-service/app/graph/co_returned.py`:
  ```python
  from datetime import datetime, timedelta, timezone
  from fastapi import APIRouter
  from app.db.postgres import get_pool
  from app.db.neo4j import session as neo4j_session

  router = APIRouter()

  DECAY_DAYS = 30
  MIN_WEIGHT = 0.05


  @router.post("/internal/graph/co-returned", status_code=202)
  async def update_co_returned():
      """Read last 24h of mcp_search_log and update CO_RETURNED edge weights."""
      pool = await get_pool()
      since = datetime.now(timezone.utc) - timedelta(hours=24)

      rows = await pool.fetch(
          """
          SELECT result_summary->>'urls' AS urls
          FROM app.mcp_search_log
          WHERE status = 'ok' AND created_at >= $1
            AND result_summary ? 'urls'
          """,
          since,
      )

      # Build co-occurrence counts
      import json
      from collections import defaultdict
      pair_counts: dict[tuple[str, str], int] = defaultdict(int)
      for row in rows:
          try:
              urls = json.loads(row["urls"])
              for i, u1 in enumerate(urls):
                  for u2 in urls[i + 1:]:
                      a, b = min(u1, u2), max(u1, u2)
                      pair_counts[(a, b)] += 1
          except Exception:
              pass

      if not pair_counts:
          return {"updated": 0}

      # Update Neo4j CO_RETURNED edges
      updated = 0
      async with neo4j_session() as s:
          for (url_a, url_b), count in pair_counts.items():
              result = await s.run(
                  """
                  MATCH (a:Document {url: $url_a}), (b:Document {url: $url_b})
                  MERGE (a)-[r:CO_RETURNED]-(b)
                  ON CREATE SET r.weight = $weight, r.observation_count = $count,
                                r.last_observed_at = $now
                  ON MATCH SET  r.weight = r.weight * $decay + $weight,
                                r.observation_count = r.observation_count + $count,
                                r.last_observed_at = $now
                  WITH r
                  WHERE r.weight < $min_weight
                  DELETE r
                  RETURN count(r) as kept
                  """,
                  url_a=url_a, url_b=url_b,
                  weight=min(count / 10.0, 1.0),
                  count=count,
                  decay=0.9,
                  min_weight=MIN_WEIGHT,
                  now=datetime.now(timezone.utc).isoformat(),
              )
              updated += 1

      return {"updated": updated}
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add agent-service/app/ingest/bootstrap.py agent-service/app/graph/
  git commit -m "feat: add bootstrap ingest and CO_RETURNED edge maintenance"
  ```

---

### Task 7: Docker build + deploy to prod

- [ ] **Step 1: Authenticate Docker to ECR**

  ```bash
  ACCOUNT_ID=$(aws sts get-caller-identity --profile aws-docs-graph --query Account --output text)
  aws ecr get-login-password --region us-east-1 --profile aws-docs-graph \
    | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com"
  ```

  Expected: `Login Succeeded`

- [ ] **Step 2: Build and push image**

  ```bash
  cd agent-service
  IMAGE_URI="${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/aws-docs-graph-agent-service:latest"
  docker build --platform linux/amd64 -t "$IMAGE_URI" .
  docker push "$IMAGE_URI"
  ```

- [ ] **Step 3: Add Python Lambda to Terraform**

  Add to `infra/envs/prod/main.tf`:
  ```hcl
  module "lambda_agent" {
    source            = "../../modules/lambda"
    function_name     = "${local.name_prefix}-agent-service"
    package_type      = "Image"
    image_uri         = "${module.ecr_agent.repository_url}:latest"
    timeout           = 300
    memory_size       = 2048
    reserved_concurrency = 5
    environment_variables = {
      ENVIRONMENT = "prod"
      AWS_REGION_NAME = var.aws_region
    }
  }

  resource "aws_lambda_function_url" "agent" {
    function_name      = module.lambda_agent.function_name
    authorization_type = "AWS_IAM"
  }
  ```

  ```bash
  cd infra/envs/prod
  terraform apply -auto-approve
  ```

- [ ] **Step 4: Run bootstrap ingest**

  Get the Lambda Function URL from Terraform output:
  ```bash
  terraform output -raw agent_function_url
  ```

  Invoke bootstrap (use AWS CLI to sign the request — it's IAM-authenticated):
  ```bash
  aws lambda invoke \
    --function-name aws-docs-graph-agent-service \
    --payload '{"path":"/internal/ingest/bootstrap","httpMethod":"POST","body":"{}"}' \
    --profile aws-docs-graph \
    response.json
  cat response.json
  ```

  Wait ~3-4 minutes. Expected: `{"run_id": "...", "processed": 500+, "failed": ...}`

- [ ] **Step 5: Verify docs in Postgres and Neo4j**

  Via Supabase SQL editor (prod) or any Postgres client:
  ```sql
  SELECT count(*) FROM app.documents WHERE status = 'active';
  ```
  Expected: ≥500

  Via Neo4j AuraDB Browser:
  ```cypher
  MATCH (d:Document) RETURN count(d)
  ```
  Expected: ≥500

- [ ] **Step 6: Commit Terraform changes**

  ```bash
  cd ../../..
  git add infra/
  git commit -m "feat: deploy Python agent-service Lambda with Function URL"
  ```

---

### Task 8: GitHub Actions CI

- [ ] **Step 1: Replace CI stub with real pipeline**

  Replace `.github/workflows/ci.yml`:
  ```yaml
  name: CI

  on:
    push:
      branches: [main]
    pull_request:

  jobs:
    lint-python:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with: { python-version: "3.12" }
        - run: pip install ruff
        - run: ruff check agent-service/
        - run: ruff format --check agent-service/

    test-python:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with: { python-version: "3.12" }
        - run: pip install -r agent-service/requirements.txt -r agent-service/requirements-dev.txt
        - run: pytest agent-service/tests/ -v
          env:
            DATABASE_URL: ""   # overridden by Testcontainers
            NEO4J_URI: ""      # overridden by Testcontainers

    lint-java:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: echo "Java lint — wired in Week 2 Day 6"

    terraform-validate:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: hashicorp/setup-terraform@v3
          with: { terraform_version: "1.8.0" }
        - run: terraform fmt -check -recursive infra/
        - run: |
            cd infra/envs/prod
            terraform init -backend=false
            terraform validate

    secret-scan:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with: { fetch-depth: 0 }
        - uses: gitleaks/gitleaks-action@v2
          env:
            GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

    dependency-scan:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with: { python-version: "3.12" }
        - run: pip install pip-audit
        - run: pip-audit -r agent-service/requirements.txt
  ```

- [ ] **Step 2: Push and verify CI green**

  ```bash
  git add .github/workflows/ci.yml
  git commit -m "ci: wire real CI pipeline (lint-python, test-python, terraform-validate, secret-scan)"
  git push origin main
  ```

  Go to GitHub → Actions → verify all jobs pass. Fix any failures before proceeding.

---

### Week 1 Gate — Final Verification

- [ ] CI green on `main` (all jobs pass)
- [ ] `make clean && make dev` → 6 Flyway migrations + Neo4j constraints applied
- [ ] ≥500 rows in `app.documents` in prod Supabase (check SQL editor)
- [ ] ≥500 `:Document` nodes in Neo4j AuraDB (check Browser)
- [ ] AWS Budget `aws-docs-graph-monthly` active, SNS subscription confirmed
- [ ] All 9 Parameter Store secrets have real values
- [ ] `git log --oneline` shows clean commit history, no secrets in any commit
