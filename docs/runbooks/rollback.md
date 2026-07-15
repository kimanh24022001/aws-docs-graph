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
