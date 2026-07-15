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
