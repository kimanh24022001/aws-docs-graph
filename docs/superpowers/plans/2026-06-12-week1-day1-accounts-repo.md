# Week 1 Day 1 — Accounts + Repo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create all external service accounts and scaffold the mono-repo with pre-commit hooks so every subsequent day starts from a clean, consistent foundation.

**Architecture:** External accounts are set up manually (browser-based); the repo scaffold is committed to git so any machine can clone and start immediately. Pre-commit hooks enforce code quality from the first commit.

**Tech Stack:** GitHub, AWS IAM, Supabase, Neo4j AuraDB Free, Anthropic Console, Vercel, pre-commit, gitleaks, ruff, spotless, prettier

---

## File Structure

```
aws-docs-graph/
├── .github/
│   └── workflows/
│       ├── ci.yml                  (stub — filled in Day 5)
│       └── deploy-prod.yml         (stub — filled in Week 2 Day 10)
├── .pre-commit-config.yaml         pre-commit hook definitions
├── .gitignore
├── .env.example                    all required env var names, no values
├── Makefile                        dev, test, lint, migrate targets (stubs for now)
└── README.md                       updated with project overview
```

---

### Task 1: Create AWS account + IAM user

- [ ] **Step 1: Create AWS account or use existing**

  Go to https://aws.amazon.com → create account or sign in.
  Enable billing alerts: Billing → Billing preferences → check "Receive Free Tier Usage Alerts" and "Receive Billing Alerts".

- [ ] **Step 2: Enable MFA on root account**

  IAM → Security recommendations → Enable MFA on root. Use an authenticator app.

- [ ] **Step 3: Create IAM user `aws-docs-graph-dev`**

  IAM → Users → Create user → name: `aws-docs-graph-dev` → attach policy `AdministratorAccess` (we'll scope this down later via Terraform).
  Create access key (CLI use case) → save `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` somewhere safe (1Password, etc.).

- [ ] **Step 4: Configure AWS CLI**

  ```bash
  aws configure --profile aws-docs-graph
  # AWS Access Key ID: <from step 3>
  # AWS Secret Access Key: <from step 3>
  # Default region: us-east-1
  # Default output format: json
  ```

  Verify:
  ```bash
  aws sts get-caller-identity --profile aws-docs-graph
  ```
  Expected output:
  ```json
  {
    "UserId": "AIDA...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/aws-docs-graph-dev"
  }
  ```

---

### Task 2: Create Supabase project

- [ ] **Step 1: Create Supabase project**

  Go to https://supabase.com → New project → name: `aws-docs-graph` → choose region closest to `us-east-1` → set a strong DB password → save it.

- [ ] **Step 2: Enable invite-only auth**

  Supabase dashboard → Authentication → Settings → scroll to "User Signups" → disable "Allow new users to sign up". Users can only be added via invite from the dashboard.

- [ ] **Step 3: Note connection strings**

  Supabase dashboard → Settings → Database:
  - **Connection string (pooler, transaction mode):** `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`
  - **Direct connection:** `postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres`
  - **JWT secret:** Settings → API → JWT Secret (copy it)
  - **Project URL:** Settings → API → Project URL (e.g. `https://[ref].supabase.co`)
  - **Anon key + Service role key:** Settings → API

  Save all of these to your password manager. You'll need them in Day 3 (Terraform → Parameter Store).

---

### Task 3: Create Neo4j AuraDB Free instance

- [ ] **Step 1: Create AuraDB Free instance**

  Go to https://console.neo4j.io → New instance → AuraDB Free → name: `aws-docs-graph` → region: `us-east-1` (or closest available).

- [ ] **Step 2: Download credentials**

  When prompted, download the `.txt` credentials file. It contains:
  - `NEO4J_URI` — bolt URI e.g. `neo4j+s://xxxx.databases.neo4j.io`
  - `NEO4J_USERNAME` — `neo4j`
  - `NEO4J_PASSWORD` — generated password

  Save to password manager.

- [ ] **Step 3: Verify connection**

  In the AuraDB console, click "Open" → Neo4j Browser → run:
  ```cypher
  RETURN 1
  ```
  Expected: returns `1`. Instance is live.

---

### Task 4: Create Anthropic API key

- [ ] **Step 1: Create API key**

  Go to https://console.anthropic.com → API Keys → Create Key → name: `aws-docs-graph-dev`.
  Save the key to your password manager.

- [ ] **Step 2: Set $5/month hard cap for dev**

  Console → Billing → Usage limits → set monthly spend limit to $5.
  This prevents runaway costs during development. Prod will have a separate key (set in Week 2).

---

### Task 5: Create Vercel project

- [ ] **Step 1: Create Vercel account / log in**

  Go to https://vercel.com → log in with GitHub.

- [ ] **Step 2: Create project (empty)**

  New Project → Import Git Repository → select `aws-docs-graph` → Framework Preset: Next.js → **do not deploy yet** (the `web/` directory doesn't exist) → skip for now.

  We'll wire this properly in Week 2 Day 8. Just confirm the Vercel account exists and is linked to the GitHub org.

---

### Task 6: Scaffold the mono-repo

- [ ] **Step 1: Initialise git repo (if not already done)**

  ```bash
  cd /path/to/aws-docs-graph
  git init
  git checkout -b main
  ```

- [ ] **Step 2: Create directory structure**

  ```bash
  mkdir -p .github/workflows
  mkdir -p infra/modules infra/envs/prod
  mkdir -p api-service
  mkdir -p agent-service
  mkdir -p web
  mkdir -p docs/superpowers/specs docs/superpowers/plans docs/runbooks
  mkdir -p scripts
  ```

- [ ] **Step 3: Create `.gitignore`**

  Create `.gitignore`:
  ```gitignore
  # Env files — never commit secrets
  .env
  .env.local
  .env.*.local

  # Java
  target/
  *.class
  .gradle/
  build/

  # Python
  __pycache__/
  *.pyc
  .venv/
  venv/
  .pytest_cache/
  .ruff_cache/
  dist/
  *.egg-info/

  # Node
  node_modules/
  .next/
  out/

  # Terraform
  .terraform/
  *.tfstate
  *.tfstate.backup
  .terraform.lock.hcl
  tfplan

  # IDE
  .idea/
  .vscode/
  *.iml

  # OS
  .DS_Store
  Thumbs.db

  # Docker
  docker-compose.override.yml
  ```

- [ ] **Step 4: Create `.env.example`**

  Create `.env.example` — every required env var, no values:
  ```bash
  # AWS
  AWS_PROFILE=aws-docs-graph
  AWS_REGION=us-east-1

  # Supabase (local dev — use Docker values; prod values in Parameter Store)
  SUPABASE_URL=http://localhost:54321
  SUPABASE_ANON_KEY=
  SUPABASE_JWT_SECRET=
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres

  # Neo4j (local dev — use Docker values; prod values in Parameter Store)
  NEO4J_URI=bolt://localhost:7687
  NEO4J_USERNAME=neo4j
  NEO4J_PASSWORD=devpassword

  # Anthropic
  ANTHROPIC_API_KEY=

  # Java api-service
  PYTHON_SERVICE_URL=http://localhost:8001
  PYTHON_SERVICE_FUNCTION_URL=  # prod only

  # Python agent-service
  JAVA_SERVICE_URL=http://localhost:8080  # not used by Python directly
  ```

- [ ] **Step 5: Create CI workflow stubs**

  Create `.github/workflows/ci.yml`:
  ```yaml
  name: CI

  on:
    push:
      branches: [main]
    pull_request:

  jobs:
    placeholder:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: echo "CI stub — real jobs added in Day 5"
  ```

  Create `.github/workflows/deploy-prod.yml`:
  ```yaml
  name: Deploy to prod

  on:
    workflow_dispatch:

  jobs:
    placeholder:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: echo "deploy-prod stub — implemented in Week 2 Day 10"
  ```

- [ ] **Step 6: Create Makefile**

  Create `Makefile`:
  ```makefile
  .PHONY: dev test lint migrate

  dev:
  	docker compose up -d
  	$(MAKE) migrate
  	@echo "Local dev running. Postgres: localhost:5432  Neo4j: localhost:7474"

  migrate:
  	@echo "Run flyway migrate (implemented Day 2)"

  test:
  	@echo "Run all tests (implemented per service)"

  lint:
  	@echo "Run all linters (implemented per service)"
  ```

- [ ] **Step 7: Commit scaffold**

  ```bash
  git add .
  git commit -m "chore: scaffold mono-repo structure, env example, CI stubs"
  ```

---

### Task 7: Install and configure pre-commit

- [ ] **Step 1: Install pre-commit**

  ```bash
  pip install pre-commit
  # or: brew install pre-commit
  ```

- [ ] **Step 2: Create `.pre-commit-config.yaml`**

  ```yaml
  repos:
    - repo: https://github.com/pre-commit/pre-commit-hooks
      rev: v4.6.0
      hooks:
        - id: trailing-whitespace
        - id: end-of-file-fixer
        - id: check-yaml
        - id: check-json
        - id: check-merge-conflict
        - id: detect-private-key

    - repo: https://github.com/astral-sh/ruff-pre-commit
      rev: v0.4.4
      hooks:
        - id: ruff
          args: [--fix]
          files: ^agent-service/
        - id: ruff-format
          files: ^agent-service/

    - repo: https://github.com/gitleaks/gitleaks
      rev: v8.18.2
      hooks:
        - id: gitleaks

    - repo: https://github.com/antonbabenko/pre-commit-terraform
      rev: v1.92.0
      hooks:
        - id: terraform_fmt
          files: ^infra/
        - id: terraform_validate
          files: ^infra/

    - repo: https://github.com/pre-commit/mirrors-prettier
      rev: v4.0.0-alpha.8
      hooks:
        - id: prettier
          files: ^web/
          types_or: [javascript, jsx, ts, tsx, css, json, markdown]
  ```

  Note: `spotless` for Java runs via Maven/Gradle, not pre-commit. It's enforced in CI instead (Day 5).

- [ ] **Step 3: Install hooks**

  ```bash
  pre-commit install
  ```

  Expected output:
  ```
  pre-commit installed at .git/hooks/pre-commit
  ```

- [ ] **Step 4: Run hooks against all files to verify**

  ```bash
  pre-commit run --all-files
  ```

  Expected: all hooks pass (nothing to lint yet in subdirs). Any failures are config issues — fix them before continuing.

- [ ] **Step 5: Commit pre-commit config**

  ```bash
  git add .pre-commit-config.yaml
  git commit -m "chore: add pre-commit hooks (ruff, gitleaks, prettier, terraform-fmt)"
  ```

---

### Task 8: Update README

- [ ] **Step 1: Update README.md**

  Update `README.md` to include the accounts checklist so anyone picking this up knows what they need:

  ```markdown
  ## Prerequisites

  Before running locally, you need accounts at:

  - **AWS** — IAM user with `AdministratorAccess`, CLI configured as profile `aws-docs-graph`
  - **Supabase** — Free project, connection strings saved
  - **Neo4j AuraDB Free** — Instance created, bolt URI + credentials saved
  - **Anthropic** — API key created, $5/mo dev cap set
  - **Vercel** — Account linked to this GitHub repo

  All secrets go into AWS Parameter Store (see `infra/`) — never in `.env` files committed to git.
  Copy `.env.example` to `.env` for local dev only.
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add README.md
  git commit -m "docs: add prerequisites section to README"
  ```

---

### Day 1 Done

Verify:
- [ ] `aws sts get-caller-identity --profile aws-docs-graph` returns your account ID
- [ ] Supabase project exists, invite-only auth enabled
- [ ] Neo4j AuraDB instance exists and responds to `RETURN 1`
- [ ] Anthropic key created, $5 dev cap set
- [ ] `git log --oneline` shows 3 commits: scaffold, pre-commit, README
- [ ] `pre-commit run --all-files` passes cleanly
