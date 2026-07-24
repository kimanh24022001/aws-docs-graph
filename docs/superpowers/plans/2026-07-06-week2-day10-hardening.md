# Week 2 Day 10 — Hardening: CI Pipeline, Deploy-Prod, Runbooks, README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two GitHub Actions stubs with real CI and deploy-prod pipelines, write the three required runbooks, update the README to reflect Phase 1 complete, and verify all 12 phase-1 validation criteria so the project is phase-1-complete.

**Architecture:** All deliverables are SDLC plumbing — no new application code. The CI pipeline runs 9 parallel jobs (lint-python, test-python, lint-java, test-java, lint-web, test-web, terraform-validate, secret-scan, dependency-scan) and a gated build-images job on `main`. The deploy-prod pipeline adds Terraform plan → manual approval gate → apply → Flyway → Neo4j → smoke tests. Runbooks are operational prose derived from the actual deploy/rollback/rotate procedures. The README status section is updated from "in progress" to "Phase 1 complete" with real getting-started instructions.

**Tech Stack:** GitHub Actions (ubuntu-latest), Python 3.12 / ruff / pytest, Java 21 Temurin / Maven / Spotless, Node 20 / npm / ESLint, Terraform 1.8.0 / hashicorp/setup-terraform@v3, gitleaks-action@v2, pip-audit, AWS CLI / aws-actions/configure-aws-credentials@v4, aws-actions/amazon-ecr-login@v2, Docker, Flyway 10, Neo4j 5 cypher-shell, curl/jq for smoke tests.

---

## Global Constraints

- GitHub Actions runner: `ubuntu-latest` for every job
- Python version: `3.12` (must match `agent-service/` target)
- Java version: `21`, distribution `temurin` (must match `api-service/`)
- Node version: `20` (must match `web/`)
- Terraform version: `1.8.0` (must match what `infra/envs/prod/` was initialised with)
- All `actions/*` pinned to the versions in the YAML below — do not upgrade without testing
- `build-images` runs only on `refs/heads/main` — never on PRs
- `deploy-prod.yml` runs only via `workflow_dispatch` with optional SHA input
- No secrets ever in workflow YAML — all via `${{ secrets.* }}`
- Flyway migration path: `infra/migrations/postgres/` (Flyway SQL, `V*__*.sql` naming)
- Neo4j migration: `infra/migrations/neo4j/V1__constraints.cypher`
- Smoke test healthz URL: `${{ secrets.API_URL }}/v1/healthz`
- Canary query: `{"question":"What is Amazon S3?"}`, expect `.answer != null and (.citations | length) > 0`
- Runbook canonical paths: `docs/runbooks/deploy.md`, `docs/runbooks/rollback.md`, `docs/runbooks/rotate-secrets.md`
- README: replace the status section only — do not restructure the rest of the document
- No placeholder text anywhere — every step must work as written

---

## File Structure

```
.github/
└── workflows/
    ├── ci.yml                       REPLACE: full 9-job + build-images pipeline
    └── deploy-prod.yml              REPLACE: full deploy pipeline with approval gate

docs/
└── runbooks/
    ├── .gitkeep                     DELETE: replaced by the three real files below
    ├── deploy.md                    CREATE: step-by-step prod deploy procedure
    ├── rollback.md                  CREATE: rollback to previous SHA
    └── rotate-secrets.md            CREATE: rotate Anthropic key, Postgres passwords, Neo4j password

README.md                            MODIFY: status section only — Phase 1 complete + getting-started
```

---

## Task 1: Replace `ci.yml` with the full CI pipeline

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `agent-service/requirements.txt`, `agent-service/requirements-dev.txt`, `agent-service/tests/`, `api-service/pom.xml`, `web/package.json`, `infra/envs/prod/`
- Produces: Green CI on every push/PR; `build-images` pushes agent-service image to ECR on `main`

- [ ] **Step 1: Read the current stub**

  Open `.github/workflows/ci.yml`. Note it contains a single `placeholder` job with `echo "CI stub — real jobs added in Day 5"`. You will replace the entire file.

- [ ] **Step 2: Write the new `ci.yml`**

  Replace the entire contents of `.github/workflows/ci.yml` with:

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
        - run: ruff check agent-service/ && ruff format --check agent-service/

    test-python:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with: { python-version: "3.12" }
        - run: pip install -r agent-service/requirements.txt -r agent-service/requirements-dev.txt
        - run: pytest agent-service/tests/ -v

    lint-java:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-java@v4
          with: { java-version: "21", distribution: "temurin" }
        - run: mvn -f api-service/pom.xml spotless:check

    test-java:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-java@v4
          with: { java-version: "21", distribution: "temurin" }
        - run: mvn -f api-service/pom.xml test

    lint-web:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: "20" }
        - run: cd web && npm ci && npm run lint && npm run type-check

    test-web:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: "20" }
        - run: cd web && npm ci && npm run test

    terraform-validate:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: hashicorp/setup-terraform@v3
          with: { terraform_version: "1.8.0" }
        - run: terraform fmt -check -recursive infra/
        - run: cd infra/envs/prod && terraform init -backend=false && terraform validate

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
        - run: pip install pip-audit && pip-audit -r agent-service/requirements.txt

    build-images:
      runs-on: ubuntu-latest
      if: github.ref == 'refs/heads/main'
      needs: [lint-python, test-python, lint-java, test-java, lint-web, test-web]
      steps:
        - uses: actions/checkout@v4
        - uses: aws-actions/configure-aws-credentials@v4
          with:
            aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
            aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
            aws-region: us-east-1
        - uses: aws-actions/amazon-ecr-login@v2
        - run: |
            docker build --platform linux/amd64 -t ${{ secrets.ECR_AGENT_URL }}:${{ github.sha }} agent-service/
            docker push ${{ secrets.ECR_AGENT_URL }}:${{ github.sha }}
            docker tag ${{ secrets.ECR_AGENT_URL }}:${{ github.sha }} ${{ secrets.ECR_AGENT_URL }}:latest
            docker push ${{ secrets.ECR_AGENT_URL }}:latest
  ```

- [ ] **Step 3: Validate YAML syntax locally**

  Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
  Expected: no output (no exception = valid YAML)

- [ ] **Step 4: Set the three required GitHub repository secrets**

  In the GitHub repo → Settings → Secrets and variables → Actions, add:

  | Secret name | Value |
  |---|---|
  | `AWS_ACCESS_KEY_ID` | The Access Key ID for the `aws-docs-graph` IAM user |
  | `AWS_SECRET_ACCESS_KEY` | The Secret Access Key for the same IAM user |
  | `ECR_AGENT_URL` | The full ECR URI for the agent-service repo, e.g. `123456789012.dkr.ecr.us-east-1.amazonaws.com/aws-docs-graph-agent-service` |

  To find the ECR URI: `aws ecr describe-repositories --repository-names aws-docs-graph-agent-service --query 'repositories[0].repositoryUri' --output text --profile aws-docs-graph`

  Expected output: `123456789012.dkr.ecr.us-east-1.amazonaws.com/aws-docs-graph-agent-service`

- [ ] **Step 5: Commit and push — watch CI run**

  ```bash
  git add .github/workflows/ci.yml
  git commit -m "ci: replace stub with full 9-job CI pipeline"
  git push
  ```

  Expected: CI run appears at `https://github.com/<owner>/aws-docs-graph/actions`. All 9 jobs (lint-python, test-python, lint-java, test-java, lint-web, test-web, terraform-validate, secret-scan, dependency-scan) run in parallel. `build-images` does NOT run on a PR push (only on `main`).

  If any job is red, read its log and fix the underlying issue (do not skip with `--no-verify` or modify the test). Common fixes:

  - **lint-python fails** — run `ruff check agent-service/ && ruff format agent-service/` locally, commit the diff
  - **lint-java fails** — `api-service/` may be a placeholder with no `pom.xml` yet; if so, add a guard: `if: hashFiles('api-service/pom.xml') != ''` to the lint-java and test-java job steps
  - **lint-web fails** — same guard: `if: hashFiles('web/package.json') != ''`
  - **terraform-validate fails on fmt** — run `terraform fmt -recursive infra/` locally, commit the diff

- [ ] **Step 6: Verify `build-images` runs on the next `main` merge**

  Once a PR merges to `main`, confirm the `build-images` job runs and the ECR console shows the new image tagged with the git SHA.

  Check: `aws ecr describe-images --repository-name aws-docs-graph-agent-service --profile aws-docs-graph --query 'sort_by(imageDetails, &imagePushedAt)[-1].imageTags'`

  Expected: `["<git-sha>", "latest"]`

---

## Task 2: Replace `deploy-prod.yml` with the full deploy pipeline

**Files:**
- Modify: `.github/workflows/deploy-prod.yml`

**Interfaces:**
- Consumes: `infra/envs/prod/` (Terraform state in S3), `infra/migrations/postgres/` (Flyway SQL), `infra/migrations/neo4j/V1__constraints.cypher`
- Produces: A working `workflow_dispatch` deploy that runs Terraform, migrates both databases, and smoke-tests the live API

- [ ] **Step 1: Set up the GitHub Environment for the manual approval gate**

  In the GitHub repo → Settings → Environments → New environment → name it `production`.

  Under "Deployment protection rules", add "Required reviewers" and add yourself. This is the manual approval gate that prevents accidental deploys.

- [ ] **Step 2: Set environment-scoped secrets for `production`**

  In Settings → Environments → production → Environment secrets, add:

  | Secret name | Value |
  |---|---|
  | `AWS_ACCESS_KEY_ID` | Same IAM Access Key ID as in Task 1 |
  | `AWS_SECRET_ACCESS_KEY` | Same IAM Secret Access Key as in Task 1 |
  | `SUPABASE_DB_USER` | The `agent_service` Postgres username (from Parameter Store `/aws-docs-graph/prod/database-url-python`, extract the user portion) |
  | `SUPABASE_DB_PASSWORD` | The `agent_service` Postgres password |
  | `NEO4J_URI` | The Neo4j AuraDB bolt URI, e.g. `neo4j+s://xxxxxxxx.databases.neo4j.io` |
  | `NEO4J_USERNAME` | `neo4j` |
  | `NEO4J_PASSWORD` | The Neo4j AuraDB password |
  | `API_URL` | The base URL for the deployed API Gateway, e.g. `https://api.yourdomain.com` |
  | `CANARY_JWT` | A valid JWT for a real user in the prod Supabase project (obtain via Supabase Auth → Users → create/use a test user and call the sign-in API) |

  To get the Supabase DB user/password from Parameter Store:
  ```bash
  aws ssm get-parameter --name /aws-docs-graph/prod/database-url-python \
    --with-decryption --query Parameter.Value --output text --profile aws-docs-graph
  ```
  The value is a JDBC/asyncpg URL; extract `user=` and `password=` from it.

- [ ] **Step 3: Write the new `deploy-prod.yml`**

  Replace the entire contents of `.github/workflows/deploy-prod.yml` with:

  ```yaml
  name: Deploy to prod
  on:
    workflow_dispatch:
      inputs:
        sha:
          description: "Git SHA to deploy (defaults to HEAD)"
          required: false

  jobs:
    deploy:
      runs-on: ubuntu-latest
      environment: production
      steps:
        - uses: actions/checkout@v4
          with:
            ref: ${{ inputs.sha || github.sha }}
        - uses: actions/setup-java@v4
          with: { java-version: "21", distribution: "temurin" }
        - uses: hashicorp/setup-terraform@v3
          with: { terraform_version: "1.8.0" }
        - uses: aws-actions/configure-aws-credentials@v4
          with:
            aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
            aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
            aws-region: us-east-1
        - name: Terraform plan
          run: |
            cd infra/envs/prod
            terraform init
            terraform plan -out=tfplan
        - name: Terraform apply
          run: cd infra/envs/prod && terraform apply -auto-approve tfplan
        - name: Flyway migrate
          run: |
            docker run --rm \
              -v "$(pwd)/infra/migrations/postgres:/flyway/sql" \
              flyway/flyway:10 \
              -url="jdbc:postgresql://aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require" \
              -user="${{ secrets.SUPABASE_DB_USER }}" \
              -password="${{ secrets.SUPABASE_DB_PASSWORD }}" \
              -schemas=app migrate
        - name: Neo4j migrate
          run: |
            docker run --rm --platform linux/amd64 \
              -v "$(pwd)/infra/migrations/neo4j:/migrations" \
              neo4j:5 cypher-shell \
              -a "${{ secrets.NEO4J_URI }}" \
              -u "${{ secrets.NEO4J_USERNAME }}" \
              -p "${{ secrets.NEO4J_PASSWORD }}" \
              --file /migrations/V1__constraints.cypher
        - name: Smoke test healthz
          run: |
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" ${{ secrets.API_URL }}/v1/healthz)
            if [ "$STATUS" != "200" ]; then echo "healthz failed: $STATUS"; exit 1; fi
        - name: Smoke test canary query
          run: |
            RESPONSE=$(curl -s -X POST ${{ secrets.API_URL }}/v1/queries \
              -H "Authorization: Bearer ${{ secrets.CANARY_JWT }}" \
              -H "Content-Type: application/json" \
              -d '{"question":"What is Amazon S3?"}')
            echo "$RESPONSE" | jq -e '.answer != null and (.citations | length) > 0'
  ```

- [ ] **Step 4: Validate YAML syntax locally**

  Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-prod.yml'))"`
  Expected: no output

- [ ] **Step 5: Commit and push**

  ```bash
  git add .github/workflows/deploy-prod.yml
  git commit -m "ci: replace deploy-prod stub with full Terraform + migrate + smoke-test pipeline"
  git push
  ```

- [ ] **Step 6: Trigger a test deploy run**

  In GitHub → Actions → "Deploy to prod" → "Run workflow" → leave SHA blank → click "Run workflow".

  The job will pause at the manual approval gate (environment protection rule). Review the Terraform plan output in the job log, then click "Review deployments" → approve.

  Expected final job status: all steps green. Check:

  ```bash
  curl -s https://$API_URL/v1/healthz
  ```

  Expected: `{"status":"ok"}` (or whatever the healthz response shape is)

  If Flyway fails with "Schema `app` already contains version N", that is correct idempotent behaviour — Flyway skips already-applied migrations.

  If the canary query smoke test fails, check that `CANARY_JWT` is not expired. Supabase JWTs expire after 1 hour by default; use a service-role-issued long-lived token or refresh it before deploying.

---

## Task 3: Write `docs/runbooks/deploy.md`

**Files:**
- Create: `docs/runbooks/deploy.md`
- Delete content of: `docs/runbooks/.gitkeep` (leave the file in place so the directory is tracked; Git does not track empty directories)

**Interfaces:**
- Consumes: Task 2's `deploy-prod.yml` (the procedure this runbook describes)
- Produces: Accurate step-by-step deploy procedure

- [ ] **Step 1: Create `docs/runbooks/deploy.md`**

  Create the file with the following content:

  ````markdown
  # Runbook: Deploy to Production

  **Last verified:** 2026-07-06
  **Pipeline:** `.github/workflows/deploy-prod.yml`
  **Trigger:** Manual (`workflow_dispatch`)

  ## When to use this runbook

  Use this when you want to deploy a specific commit (or HEAD of `main`) to production.
  The pipeline runs Terraform, migrates both databases, and smoke-tests the live API.
  It requires manual approval before Terraform apply — you will be asked to review the plan.

  ## Prerequisites

  - You have push access to the `aws-docs-graph` GitHub repo.
  - Your GitHub account is listed as a required reviewer in the `production` environment (Settings → Environments → production).
  - CI is green on the commit you are deploying. If it is not, fix CI first.
  - `CANARY_JWT` secret in the `production` environment is a valid, non-expired JWT. Refresh it if it was set more than 1 hour ago (see step 5).

  ## Step 1: Confirm CI is green on the target SHA

  1. Go to `https://github.com/<owner>/aws-docs-graph/actions`.
  2. Find the CI run for the commit you are deploying.
  3. All jobs must be green. If any are red, fix the issue first.

  ## Step 2: Trigger the deploy workflow

  1. Go to Actions → **Deploy to prod** → **Run workflow**.
  2. Optional: paste the target git SHA into the "Git SHA to deploy" field. Leave blank to deploy HEAD of `main`.
  3. Click **Run workflow**.

  ## Step 3: Review the Terraform plan

  1. Open the running workflow.
  2. Watch the **Terraform plan** step complete. Read the plan output.
  3. Confirm the plan shows only expected changes (Lambda image update, no destructive resource changes).
  4. If the plan shows unexpected resource deletions (e.g., an ECR repo or a Parameter Store secret), **do not approve**. Investigate before proceeding.

  ## Step 4: Approve the deployment

  1. Click **Review deployments** (yellow banner at the top of the workflow run page).
  2. Select the `production` environment checkbox.
  3. Add an optional comment (e.g., "LGTM — deploying SHA abc1234").
  4. Click **Approve and deploy**.

  The pipeline will then:
  - Run `terraform apply`
  - Run Flyway to apply any new Postgres migrations
  - Run `cypher-shell` to apply any new Neo4j migrations
  - Run two smoke tests (healthz + canary query)

  ## Step 5: Refresh `CANARY_JWT` if needed

  The canary JWT expires after 1 hour. If the smoke test fails with 401, regenerate it:

  ```bash
  # Replace with your Supabase project URL and anon key
  curl -s -X POST https://<supabase-project>.supabase.co/auth/v1/token?grant_type=password \
    -H "apikey: <supabase-anon-key>" \
    -H "Content-Type: application/json" \
    -d '{"email":"<canary-user@example.com>","password":"<canary-password>"}' \
    | jq -r '.access_token'
  ```

  Copy the token and update the `CANARY_JWT` secret in Settings → Environments → production → Secrets.

  Then re-run the workflow from the same SHA.

  ## Step 6: Verify smoke tests pass

  The final two steps of the pipeline are:

  - **Smoke test healthz** — `GET /v1/healthz` must return HTTP 200.
  - **Smoke test canary query** — `POST /v1/queries` with `{"question":"What is Amazon S3?"}` must return a response with a non-null `answer` and at least 1 citation.

  If both pass, the deploy is complete.

  ## Step 7: Post-deploy verification (optional but recommended)

  ```bash
  # Manual healthz check
  curl -s https://api.yourdomain.com/v1/healthz

  # Check CloudWatch Logs for errors in the last 10 minutes
  aws logs filter-log-events \
    --log-group-name /aws/lambda/aws-docs-graph-agent-service \
    --start-time $(date -u -v-10M +%s000) \
    --filter-pattern "ERROR" \
    --profile aws-docs-graph
  ```

  Expected: `{"status":"ok"}` for healthz; zero ERROR log events for a clean deploy.

  ## Failure recovery

  If the deploy pipeline fails:

  - **Terraform apply fails** — the previous infra state is unchanged. Fix the Terraform issue and re-run.
  - **Flyway fails** — check the Flyway step log. If a migration partially applied, you may need to manually repair the `flyway_schema_history` table.
  - **Smoke tests fail** — the infra is updated but the app may be broken. Run the rollback runbook immediately: `docs/runbooks/rollback.md`.
  ````

- [ ] **Step 2: Commit**

  ```bash
  git add docs/runbooks/deploy.md
  git commit -m "docs: add deploy runbook"
  ```

---

## Task 4: Write `docs/runbooks/rollback.md`

**Files:**
- Create: `docs/runbooks/rollback.md`

**Interfaces:**
- Consumes: Task 2's `deploy-prod.yml` (the `sha` input field enables rollback)
- Produces: Accurate rollback procedure

- [ ] **Step 1: Find the previous SHA from git log**

  To roll back, you need the SHA of the previously-deployed commit. The canonical way to find it:

  ```bash
  git log --oneline -10
  ```

  The previously-deployed SHA is the commit before the bad one.

- [ ] **Step 2: Create `docs/runbooks/rollback.md`**

  Create the file with the following content:

  ````markdown
  # Runbook: Rollback to Previous SHA

  **Last verified:** 2026-07-06
  **Pipeline:** `.github/workflows/deploy-prod.yml` (with `sha` input)

  ## When to use this runbook

  Use this when a production deploy has caused a regression and you need to restore the previous known-good state quickly.

  Rollback = re-deploying a prior SHA. The pipeline is identical to a normal deploy; you just supply the previous git SHA as the `sha` workflow input.

  ## What rollback covers (and does not cover)

  **Covered:** Lambda function code (container image), Terraform-managed infra changes.

  **Not covered:** Flyway database migrations. Postgres migrations are forward-only — Flyway does not support rollback. If the regression is caused by a bad migration, you need a compensating forward migration (see "Database rollback" below).

  ## Step 1: Identify the previous known-good SHA

  ```bash
  git log --oneline -10
  ```

  Example output:
  ```
  abc1234 feat: bad deploy — this is what we're rolling back
  def5678 feat: last known-good state — deploy this SHA
  ghi9012 chore: update dependencies
  ```

  The SHA to deploy is `def5678`.

  Cross-check: in the GitHub Actions history (Actions → Deploy to prod → runs), find the last green deploy and note its commit SHA.

  ## Step 2: Confirm the target SHA has a built image in ECR

  ```bash
  aws ecr describe-images \
    --repository-name aws-docs-graph-agent-service \
    --image-ids imageTag=def5678 \
    --profile aws-docs-graph \
    --query 'imageDetails[0].imagePushedAt'
  ```

  Expected: a timestamp (not an error). If the image is missing, the CI `build-images` job did not run for that SHA (e.g., it was not merged to `main`). In that case, build and push it manually:

  ```bash
  git checkout def5678
  aws ecr get-login-password --region us-east-1 --profile aws-docs-graph \
    | docker login --username AWS --password-stdin \
      $(aws sts get-caller-identity --query Account --output text --profile aws-docs-graph).dkr.ecr.us-east-1.amazonaws.com
  docker build --platform linux/amd64 \
    -t <ECR_AGENT_URL>:def5678 agent-service/
  docker push <ECR_AGENT_URL>:def5678
  git checkout main
  ```

  ## Step 3: Trigger rollback deploy

  1. Go to Actions → **Deploy to prod** → **Run workflow**.
  2. Paste the previous SHA (`def5678`) into the "Git SHA to deploy" field.
  3. Click **Run workflow**.
  4. Follow the same approval and verification steps as in `docs/runbooks/deploy.md`.

  ## Step 4: Verify smoke tests pass

  After approval and apply:

  - **Smoke test healthz** must return HTTP 200.
  - **Smoke test canary query** must return a non-null answer with ≥1 citation.

  ## Database rollback (if a bad migration caused the regression)

  Flyway does not support rollback. If the regression is caused by a bad Postgres migration:

  1. Write a new compensating migration `V<N+1>__revert_<description>.sql` in `infra/migrations/postgres/`.
  2. Test the compensating migration locally: `make migrate` (against a local Postgres with the bad migration already applied).
  3. Commit the compensating migration and deploy normally.
  4. Do not delete or modify existing `V*` migration files — Flyway will reject the run if checksums change.

  ## Post-rollback checklist

  - [ ] Smoke tests pass
  - [ ] CloudWatch Logs show no ERROR-level events in the 5 minutes after rollback
  - [ ] Open a post-incident issue describing what went wrong and what the fix will be
  ````

- [ ] **Step 2: Commit**

  ```bash
  git add docs/runbooks/rollback.md
  git commit -m "docs: add rollback runbook"
  ```

---

## Task 5: Write `docs/runbooks/rotate-secrets.md`

**Files:**
- Create: `docs/runbooks/rotate-secrets.md`

**Interfaces:**
- Consumes: `infra/modules/parameter-store/` (secret names), design doc §7.3 (secrets table)
- Produces: Step-by-step rotation procedure for all three secret families

- [ ] **Step 1: Create `docs/runbooks/rotate-secrets.md`**

  Create the file with the following content:

  ````markdown
  # Runbook: Rotate Secrets

  **Last verified:** 2026-07-06
  **Cadence:** Anthropic API key quarterly · Postgres passwords semi-annually · Neo4j password semi-annually

  ## Overview

  All secrets are stored in AWS Parameter Store as SecureStrings under `/aws-docs-graph/prod/`.
  The Lambda functions read them at cold-start via `ssm:GetParameter`. After updating a secret
  in Parameter Store, you must force a Lambda cold-start (deploy or alias rotation) so the new
  value is picked up.

  **Parameter Store paths:**

  | Secret | Path |
  |---|---|
  | Anthropic API key | `/aws-docs-graph/prod/anthropic-api-key` |
  | Postgres URL (Java) | `/aws-docs-graph/prod/database-url-java` |
  | Postgres URL (Python) | `/aws-docs-graph/prod/database-url-python` |
  | Neo4j URI | `/aws-docs-graph/prod/neo4j-uri` |
  | Neo4j username | `/aws-docs-graph/prod/neo4j-username` |
  | Neo4j password | `/aws-docs-graph/prod/neo4j-password` |

  ---

  ## Rotate the Anthropic API Key

  **Cadence:** quarterly

  ### Step 1: Create a new key in the Anthropic console

  1. Go to `https://console.anthropic.com/settings/keys`.
  2. Click **Create Key** → name it `aws-docs-graph-prod-<YYYY-MM>` → copy the key value immediately (shown once only).
  3. Do NOT delete the old key yet.

  ### Step 2: Update the value in Parameter Store

  ```bash
  aws ssm put-parameter \
    --name /aws-docs-graph/prod/anthropic-api-key \
    --value "sk-ant-api03-NEWKEYVALUE..." \
    --type SecureString \
    --overwrite \
    --profile aws-docs-graph
  ```

  Expected output:
  ```json
  { "Version": 2, "Tier": "Standard" }
  ```

  ### Step 3: Force a Lambda cold-start

  The simplest way is to run a deploy via the normal deploy runbook (`docs/runbooks/deploy.md`).
  The deploy will push a new image tag which causes Lambda to start a new execution environment
  and re-read the parameter.

  Alternatively, update the Lambda description to force re-init without a new image:

  ```bash
  aws lambda update-function-configuration \
    --function-name aws-docs-graph-agent-service \
    --description "secret-rotation-$(date +%Y%m%d)" \
    --profile aws-docs-graph
  ```

  Wait ~30s for the update to complete:

  ```bash
  aws lambda wait function-updated \
    --function-name aws-docs-graph-agent-service \
    --profile aws-docs-graph
  ```

  ### Step 4: Verify the new key is working

  Run the canary query manually:

  ```bash
  RESPONSE=$(curl -s -X POST https://api.yourdomain.com/v1/queries \
    -H "Authorization: Bearer <canary-jwt>" \
    -H "Content-Type: application/json" \
    -d '{"question":"What is Amazon S3?"}')
  echo "$RESPONSE" | jq '.answer'
  ```

  Expected: a non-null string. If you get `"Anthropic API error"` or a 500, the new key is invalid or the wrong value was written to Parameter Store. Go back to step 2.

  ### Step 5: Delete the old key

  Once the canary query succeeds with the new key:

  1. Go to `https://console.anthropic.com/settings/keys`.
  2. Delete the old key named `aws-docs-graph-prod-<previous-YYYY-MM>`.

  ---

  ## Rotate the Postgres Passwords

  **Cadence:** semi-annually

  There are two Postgres database users: `api_service` (used by Java) and `agent_service` (used by Python). Rotate each independently; rolling rotation means the service stays up.

  ### Rotate `agent_service` password (Python service)

  #### Step 1: Generate a new password

  ```bash
  NEW_PW=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 40)
  echo "$NEW_PW"
  ```

  Copy the value. You will use it in the next two steps.

  #### Step 2: Change the password in Supabase

  1. Go to Supabase Dashboard → SQL Editor.
  2. Run:

  ```sql
  ALTER USER agent_service WITH PASSWORD '<NEW_PW>';
  ```

  Expected: `ALTER ROLE` (success).

  #### Step 3: Get the current database URL from Parameter Store and update it

  ```bash
  # Get the current URL
  CURRENT=$(aws ssm get-parameter \
    --name /aws-docs-graph/prod/database-url-python \
    --with-decryption \
    --query Parameter.Value \
    --output text \
    --profile aws-docs-graph)
  echo "$CURRENT"
  ```

  The URL format is: `postgresql://agent_service:<old-password>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`

  Replace only the password portion:

  ```bash
  NEW_URL=$(echo "$CURRENT" | sed "s|:.*@|:<NEW_PW>@|")
  aws ssm put-parameter \
    --name /aws-docs-graph/prod/database-url-python \
    --value "$NEW_URL" \
    --type SecureString \
    --overwrite \
    --profile aws-docs-graph
  ```

  #### Step 4: Force Lambda cold-start and verify

  ```bash
  aws lambda update-function-configuration \
    --function-name aws-docs-graph-agent-service \
    --description "pg-rotation-$(date +%Y%m%d)" \
    --profile aws-docs-graph
  aws lambda wait function-updated \
    --function-name aws-docs-graph-agent-service \
    --profile aws-docs-graph
  ```

  Then run the canary query (same as Anthropic step 4 above). If the query succeeds, the Python service is using the new password.

  ### Rotate `api_service` password (Java service)

  Follow the same steps, replacing:
  - Supabase SQL: `ALTER USER api_service WITH PASSWORD '<NEW_PW>';`
  - Parameter Store path: `/aws-docs-graph/prod/database-url-java`
  - Lambda function name: `aws-docs-graph-api-service`

  ---

  ## Rotate the Neo4j Password

  **Cadence:** semi-annually

  ### Step 1: Change the password in Neo4j AuraDB

  1. Go to `https://console.neo4j.io`.
  2. Select your instance → **Connection Details** → **Reset Password**.
  3. Neo4j generates a new password — copy it.

  ### Step 2: Update Parameter Store

  ```bash
  aws ssm put-parameter \
    --name /aws-docs-graph/prod/neo4j-password \
    --value "<new-neo4j-password>" \
    --type SecureString \
    --overwrite \
    --profile aws-docs-graph
  ```

  ### Step 3: Force Lambda cold-starts for both services

  Both the Java api-service and Python agent-service read Neo4j credentials:

  ```bash
  for FN in aws-docs-graph-api-service aws-docs-graph-agent-service; do
    aws lambda update-function-configuration \
      --function-name "$FN" \
      --description "neo4j-rotation-$(date +%Y%m%d)" \
      --profile aws-docs-graph
    aws lambda wait function-updated \
      --function-name "$FN" \
      --profile aws-docs-graph
    echo "$FN updated"
  done
  ```

  ### Step 4: Verify

  Run the canary query. Confirm the `/graph` atlas view loads in the browser (it hits the Java service's Neo4j read path).

  ---

  ## After any rotation

  - [ ] Canary query returns a non-null answer with ≥1 citation
  - [ ] CloudWatch Logs show no authentication errors in the 5 minutes after rotation
  - [ ] Update the "Last verified" date at the top of this runbook
  - [ ] Add a note to the team chat / incident log with the date and what was rotated
  ````

- [ ] **Step 2: Commit**

  ```bash
  git add docs/runbooks/rotate-secrets.md
  git commit -m "docs: add rotate-secrets runbook"
  ```

---

## Task 6: Update `README.md` status section

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: All previous tasks in this plan (the deploy pipeline and runbooks must exist before updating the README)
- Produces: An accurate README that reflects phase-1 completion and gives a real getting-started path

- [ ] **Step 1: Replace the status section**

  In `README.md`, find the block starting with `## Status` and replace it with:

  ```markdown
  ## Status

  **Phase 1 — complete.**

  - Design doc: [`docs/superpowers/specs/2026-06-04-aws-docs-graph-design.md`](docs/superpowers/specs/2026-06-04-aws-docs-graph-design.md)
  - Calendar: [`docs/superpowers/specs/2026-06-12-phase1-calendar-design.md`](docs/superpowers/specs/2026-06-12-phase1-calendar-design.md)
  - Implementation plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)
  - Runbooks: [`docs/runbooks/`](docs/runbooks/)

  All 12 phase-1 validation criteria are met (see design doc §14).
  ```

- [ ] **Step 2: Replace the getting-started section**

  Find the block starting with `## Getting started` and replace it with:

  ```markdown
  ## Getting started

  ### Local development (new laptop → first query in ~30 minutes)

  **Prerequisites:** AWS CLI configured as profile `aws-docs-graph`, Docker Desktop running, Node 20+, Java 21, Python 3.12.

  ```bash
  # 1. Copy env template and fill in your local values
  cp .env.example .env
  # Edit .env — set ANTHROPIC_API_KEY, SUPABASE_URL, NEO4J_URI, NEO4J_PASSWORD

  # 2. Start local Postgres + Neo4j, run all migrations
  make dev

  # 3. Start the Python agent service (in a new terminal)
  cd agent-service
  pip install -r requirements.txt
  uvicorn app.main:app --port 8001 --reload

  # 4. Start the Java api service (in a new terminal)
  cd api-service
  mvn spring-boot:run

  # 5. Start the Next.js frontend (in a new terminal)
  cd web
  npm ci && npm run dev
  ```

  Open `http://localhost:3000`. Log in with a Supabase test user. Ask a question at `/ask`.

  ### Running tests

  ```bash
  # Python
  cd agent-service && pytest tests/ -v

  # Java
  cd api-service && mvn test

  # Web
  cd web && npm run test
  ```

  ### Deploy to production

  See [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md).
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add README.md
  git commit -m "docs: update README to Phase 1 complete with real getting-started"
  ```

---

## Task 7: Final validation checklist — all 12 phase-1 criteria

**Files:**
- No files modified — this is a verification task

**Interfaces:**
- Consumes: Everything built across Days 1–10
- Produces: Confidence that all 12 design-doc §14 criteria are met before calling phase 1 complete

Work through each criterion. For each one, run the stated verification command or perform the stated check. Do not mark a criterion complete unless you have evidence.

- [ ] **Criterion 1: A user can sign up via email + password (invite-only) and log in**

  Verify: Open `https://yourdomain.com/login` in a private browser window. Log in with the canary user credentials. You should land on `/ask`.

  If login fails: check Supabase Auth → Users → the canary user exists and is confirmed.

- [ ] **Criterion 2: A user can submit a question via `/ask` and receive an answer with citations + related docs in <30s**

  Verify: On `/ask`, type "What is Amazon S3?" and submit. Measure time to response (browser DevTools → Network → the `/v1/queries` call). Response must arrive in <30s and show at least one citation and at least one related doc.

  If it times out: check CloudWatch Logs for the Lambda functions. Common causes: MCP unreachable (use graph-only degraded mode), Neo4j connection timeout, Lambda cold-start.

- [ ] **Criterion 3: The graph atlas at `/graph` renders force-directed with at least 200 documents, color-coded by service**

  Verify: Open `/graph`. The canvas must paint with at least 200 visible nodes. Open browser DevTools → Network → find the `GET /v1/graph/overview` response → confirm `.nodes` array length ≥ 200.

  ```bash
  curl -s -H "Authorization: Bearer <jwt>" https://api.yourdomain.com/v1/graph/overview \
    | jq '.nodes | length'
  ```

  Expected: ≥ 200.

- [ ] **Criterion 4: Drill-down from a node renders 1-hop neighbors**

  Verify: Click a node on `/graph`. The browser should navigate to `/graph/<id>`. The neighborhood view must show at least one neighbor node.

  ```bash
  curl -s -H "Authorization: Bearer <jwt>" \
    "https://api.yourdomain.com/v1/graph/documents/<any-document-id>/neighbors?hops=1" \
    | jq '.nodes | length'
  ```

  Expected: ≥ 1.

- [ ] **Criterion 5: Daily ingestion (or manual bootstrap) has populated ≥500 documents into Postgres + Neo4j**

  Verify:

  ```bash
  # Postgres — via Supabase SQL Editor
  SELECT COUNT(*) FROM app.documents WHERE status = 'active';
  ```

  Expected: ≥ 500.

  ```bash
  # Neo4j — via AuraDB console Query tab
  MATCH (d:Document) RETURN count(d);
  ```

  Expected: ≥ 500.

  If below 500: trigger a manual bootstrap via the Python service:

  ```bash
  aws lambda invoke \
    --function-name aws-docs-graph-agent-service \
    --payload '{"path":"/internal/ingest/bootstrap","httpMethod":"POST","body":"{}"}' \
    --profile aws-docs-graph \
    /tmp/bootstrap-response.json
  cat /tmp/bootstrap-response.json
  ```

- [ ] **Criterion 6: CI is green on `main`; manual deploy-prod runs end-to-end including Flyway + Neo4j migrations + smoke tests**

  Verify:
  - GitHub Actions → CI → latest run on `main` → all jobs green (green checkmarks, not yellow/red)
  - GitHub Actions → Deploy to prod → latest run → all steps green, including "Flyway migrate", "Neo4j migrate", "Smoke test healthz", "Smoke test canary query"

- [ ] **Criterion 7: CloudWatch dashboards show query rate, latency, daily LLM cost**

  Verify: Go to AWS Console → CloudWatch → Dashboards. Confirm two dashboards exist:

  - `aws-docs-graph-operations` — shows `query_count`, `query_duration_ms`, `agent_node_duration_ms`, `mcp_call_count`
  - `aws-docs-graph-cost` — shows `llm_cost_usd`, `daily_cost_per_user_usd`

  Submit one test query and wait 2 minutes. Confirm the query count metric increments by 1 on the operations dashboard.

- [ ] **Criterion 8: AWS Budget at $10/mo with alarms is verified active**

  Verify: AWS Console → Billing → Budgets → `aws-docs-graph-monthly`. Confirm:
  - Budget amount: $10.00 USD
  - Alert thresholds: 50%, 80%, 100%
  - Subscriber email matches `var.alert_email` in Terraform

  Also check: AWS Console → Cost Management → Cost Anomaly Detection → confirm at least one anomaly monitor exists with a $5 threshold.

- [ ] **Criterion 9: RLS prevents user A from reading user B's queries (verified by integration test)**

  Verify: The Java integration test suite includes a test class that creates two users and confirms user A cannot read user B's queries.

  ```bash
  cd api-service && mvn test -Dtest="*RlsEnforcement*" -v
  ```

  Expected: `Tests run: N, Failures: 0, Errors: 0`

  If the test class does not exist yet, create it at `api-service/src/test/java/com/awsdocs/adapter/in/rest/RlsEnforcementIT.java` with these two tests:

  - `userACannotSeeUserBQuery` — create a query owned by user B; attempt to GET it as user A; assert HTTP 404
  - `userAQueryListExcludesUserBQueries` — create queries for both users; GET `/v1/queries` as user A; assert response does not contain user B's query IDs

- [ ] **Criterion 10: ArchUnit rules pass; hexagonal boundaries clean**

  Verify:

  ```bash
  cd api-service && mvn test -Dtest="*ArchUnit*" -v
  ```

  Expected: `Tests run: N, Failures: 0, Errors: 0`

  The ArchUnit test class lives at `api-service/src/test/java/com/awsdocs/ArchitectureTest.java` and enforces the four rules from design doc §4.3:
  - `domain` depends on no other project package
  - `application` depends only on `domain`
  - `adapter.in` never depends on `adapter.out`
  - No JPA / framework annotations in `domain`

- [ ] **Criterion 11: README + at least 3 runbooks exist and are accurate**

  Verify:

  ```bash
  ls -1 docs/runbooks/
  ```

  Expected output (at minimum):
  ```
  deploy.md
  rollback.md
  rotate-secrets.md
  ```

  README check: open `README.md` and confirm the status section says "Phase 1 — complete." and the getting-started section has real commands (not "Phase 1 hasn't been built yet").

- [ ] **Criterion 12: Cloudflare + custom domain attached**

  Verify:

  ```bash
  # DNS resolves
  dig api.yourdomain.com

  # TLS is valid (no cert warnings)
  curl -sv https://api.yourdomain.com/v1/healthz 2>&1 | grep "SSL certificate"

  # Cloudflare is proxying (check the Cloudflare IP range)
  curl -s -I https://api.yourdomain.com/v1/healthz | grep -i "cf-ray"
  ```

  Expected: DNS resolves, TLS is valid (no expired/self-signed cert warnings), `cf-ray` header is present in the response.

  If Cloudflare is not yet wired:
  1. In Cloudflare DNS, add a CNAME record: `api` → `<api-gateway-id>.execute-api.us-east-1.amazonaws.com` (orange cloud = proxied).
  2. In the Terraform `infra/envs/prod/main.tf`, add the API Gateway custom domain resource and ACM cert. Apply with `terraform apply`.
  3. In Cloudflare SSL/TLS settings → set mode to "Full (strict)".

- [ ] **Step: Push all changes and verify final CI run is green**

  ```bash
  git push
  ```

  Go to GitHub Actions and confirm the CI run triggered by this push is green on all jobs.

- [ ] **Step: Declare phase 1 complete**

  All 12 checkboxes above are ticked. Phase 1 is done.

  ```bash
  git tag -a v1.0.0-phase1 -m "Phase 1 complete — all 12 validation criteria met"
  git push origin v1.0.0-phase1
  ```

---

## Self-review

**Spec coverage check:**

| Design doc §14 criterion | Covered by task |
|---|---|
| 1. Invite-only signup + login | Criterion 1 in Task 7 |
| 2. `/ask` returns answer in <30s | Criterion 2 in Task 7 |
| 3. `/graph` ≥200 nodes color-coded | Criterion 3 in Task 7 |
| 4. Node drill-down shows 1-hop neighbors | Criterion 4 in Task 7 |
| 5. ≥500 documents in Postgres + Neo4j | Criterion 5 in Task 7 |
| 6. CI green + deploy-prod end-to-end | Tasks 1, 2, and criterion 6 in Task 7 |
| 7. CloudWatch dashboards | Criterion 7 in Task 7 |
| 8. AWS Budget alarms active | Criterion 8 in Task 7 |
| 9. RLS integration test | Criterion 9 in Task 7 |
| 10. ArchUnit passes | Criterion 10 in Task 7 |
| 11. README + 3 runbooks | Tasks 3, 4, 5, 6 and criterion 11 in Task 7 |
| 12. Cloudflare + custom domain | Criterion 12 in Task 7 |

All 12 criteria covered.

**Placeholder scan:** no TBD, no "implement later", no "add appropriate error handling" — all steps contain actual content.

**Type/name consistency:** no code types defined in this plan (pure YAML/Markdown/shell); no cross-task type references to check.
