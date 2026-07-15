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

- [ ] Canary query returns a non-null answer with >=1 citation
- [ ] CloudWatch Logs show no authentication errors in the 5 minutes after rotation
- [ ] Update the "Last verified" date at the top of this runbook
- [ ] Add a note to the team chat / incident log with the date and what was rotated
