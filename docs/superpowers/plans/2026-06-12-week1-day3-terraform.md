# Week 1 Day 3 — Terraform + AWS Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the Terraform state backend, define all AWS infrastructure as code, and store all secrets in Parameter Store — so `terraform apply` produces a fully wired AWS environment ready for application deployments.

**Architecture:** Terraform state lives in S3 + DynamoDB (created by a one-time bootstrap script). Infrastructure is split into focused modules under `infra/modules/` composed in `infra/envs/prod/`. All secrets are placeholder SecureStrings in Parameter Store — values are set manually, never in code. `terraform validate` + `tflint` pass in CI from this day forward.

**Tech Stack:** Terraform ≥1.8, AWS provider, S3, DynamoDB, Lambda, API Gateway REST, ECR, IAM, Parameter Store, EventBridge, CloudWatch, SNS, AWS Budgets

---

## File Structure

```
scripts/
└── bootstrap-aws.sh              one-time: creates S3 bucket + DynamoDB table for TF state

infra/
├── modules/
│   ├── lambda/
│   │   ├── main.tf               Lambda function + log group + IAM exec role
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── ecr/
│   │   ├── main.tf               ECR repository
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── api-gateway/
│   │   ├── main.tf               REST API + Lambda Authorizer + usage plan + CORS
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── parameter-store/
│       ├── main.tf               SecureString placeholders
│       ├── variables.tf
│       └── outputs.tf
└── envs/
    └── prod/
        ├── main.tf               compose modules, tags
        ├── variables.tf
        ├── outputs.tf
        ├── terraform.tfvars      non-secret config values (committed)
        └── backend.tf            S3 backend config
```

---

### Task 1: Bootstrap Terraform state backend

- [ ] **Step 1: Create bootstrap script**

  Create `scripts/bootstrap-aws.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  PROFILE="${AWS_PROFILE:-aws-docs-graph}"
  REGION="${AWS_REGION:-us-east-1}"
  ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
  BUCKET="aws-docs-graph-tfstate-${ACCOUNT_ID}"
  TABLE="aws-docs-graph-tfstate-lock"

  echo "Creating Terraform state bucket: $BUCKET"
  if aws s3api head-bucket --bucket "$BUCKET" --profile "$PROFILE" 2>/dev/null; then
    echo "  Bucket already exists — skipping"
  else
    aws s3api create-bucket \
      --bucket "$BUCKET" \
      --region "$REGION" \
      --profile "$PROFILE"

    aws s3api put-bucket-versioning \
      --bucket "$BUCKET" \
      --versioning-configuration Status=Enabled \
      --profile "$PROFILE"

    aws s3api put-bucket-encryption \
      --bucket "$BUCKET" \
      --server-side-encryption-configuration \
        '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
      --profile "$PROFILE"

    aws s3api put-public-access-block \
      --bucket "$BUCKET" \
      --public-access-block-configuration \
        'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' \
      --profile "$PROFILE"

    echo "  ✅ Bucket created"
  fi

  echo "Creating DynamoDB lock table: $TABLE"
  if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" --profile "$PROFILE" 2>/dev/null; then
    echo "  Table already exists — skipping"
  else
    aws dynamodb create-table \
      --table-name "$TABLE" \
      --attribute-definitions AttributeName=LockID,AttributeType=S \
      --key-schema AttributeName=LockID,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST \
      --region "$REGION" \
      --profile "$PROFILE"
    echo "  ✅ Table created"
  fi

  echo ""
  echo "✅ Bootstrap complete."
  echo "   Add this to infra/envs/prod/backend.tf:"
  echo "   bucket = \"$BUCKET\""
  echo "   dynamodb_table = \"$TABLE\""
  echo "   region = \"$REGION\""
  ```

  ```bash
  chmod +x scripts/bootstrap-aws.sh
  ```

- [ ] **Step 2: Run bootstrap**

  ```bash
  ./scripts/bootstrap-aws.sh
  ```

  Expected output ends with:
  ```
  ✅ Bootstrap complete.
     Add this to infra/envs/prod/backend.tf:
     bucket = "aws-docs-graph-tfstate-123456789012"
     ...
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add scripts/bootstrap-aws.sh
  git commit -m "chore: add Terraform state bootstrap script"
  ```

---

### Task 2: Terraform backend + provider config

- [ ] **Step 1: Create backend config**

  Create `infra/envs/prod/backend.tf` (replace bucket value with output from bootstrap script):
  ```hcl
  terraform {
    required_version = ">= 1.8"

    required_providers {
      aws = {
        source  = "hashicorp/aws"
        version = "~> 5.50"
      }
    }

    backend "s3" {
      bucket         = "aws-docs-graph-tfstate-123456789012"  # replace with your account ID
      key            = "prod/terraform.tfstate"
      region         = "us-east-1"
      dynamodb_table = "aws-docs-graph-tfstate-lock"
      encrypt        = true
    }
  }
  ```

- [ ] **Step 2: Create main provider config**

  Create `infra/envs/prod/main.tf`:
  ```hcl
  provider "aws" {
    region  = var.aws_region
    profile = var.aws_profile

    default_tags {
      tags = {
        project    = "aws-docs-graph"
        env        = "prod"
        cost-center = "learning"
      }
    }
  }

  locals {
    name_prefix = "aws-docs-graph"
  }
  ```

- [ ] **Step 3: Create variables**

  Create `infra/envs/prod/variables.tf`:
  ```hcl
  variable "aws_region" {
    default = "us-east-1"
  }

  variable "aws_profile" {
    default = "aws-docs-graph"
  }

  variable "alert_email" {
    description = "Email address for CloudWatch alarms and budget alerts"
    type        = string
  }
  ```

  Create `infra/envs/prod/terraform.tfvars`:
  ```hcl
  aws_region  = "us-east-1"
  aws_profile = "aws-docs-graph"
  alert_email = "your-email@example.com"
  ```

- [ ] **Step 4: Terraform init**

  ```bash
  cd infra/envs/prod
  terraform init
  ```

  Expected: `Terraform has been successfully initialized!`

- [ ] **Step 5: Commit**

  ```bash
  git add infra/envs/prod/
  git commit -m "chore: add Terraform backend config and provider"
  ```

---

### Task 3: ECR module

- [ ] **Step 1: Create ECR module**

  Create `infra/modules/ecr/main.tf`:
  ```hcl
  resource "aws_ecr_repository" "this" {
    name                 = var.name
    image_tag_mutability = "MUTABLE"

    image_scanning_configuration {
      scan_on_push = true
    }

    lifecycle {
      prevent_destroy = true
    }
  }

  resource "aws_ecr_lifecycle_policy" "this" {
    repository = aws_ecr_repository.this.name
    policy = jsonencode({
      rules = [{
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }]
    })
  }
  ```

  Create `infra/modules/ecr/variables.tf`:
  ```hcl
  variable "name" {
    type = string
  }
  ```

  Create `infra/modules/ecr/outputs.tf`:
  ```hcl
  output "repository_url" {
    value = aws_ecr_repository.this.repository_url
  }

  output "repository_name" {
    value = aws_ecr_repository.this.name
  }
  ```

- [ ] **Step 2: Add ECR repos to prod env**

  Add to `infra/envs/prod/main.tf`:
  ```hcl
  module "ecr_api" {
    source = "../../modules/ecr"
    name   = "${local.name_prefix}-api-service"
  }

  module "ecr_agent" {
    source = "../../modules/ecr"
    name   = "${local.name_prefix}-agent-service"
  }
  ```

- [ ] **Step 3: Validate**

  ```bash
  cd infra/envs/prod && terraform validate
  ```
  Expected: `Success! The configuration is valid.`

---

### Task 4: Lambda module

- [ ] **Step 1: Create Lambda module**

  Create `infra/modules/lambda/main.tf`:
  ```hcl
  resource "aws_iam_role" "exec" {
    name = "${var.function_name}-exec-role"
    assume_role_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }]
    })
  }

  resource "aws_iam_role_policy_attachment" "basic_exec" {
    role       = aws_iam_role.exec.name
    policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  }

  resource "aws_iam_role_policy_attachment" "xray" {
    role       = aws_iam_role.exec.name
    policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
  }

  resource "aws_iam_role_policy" "ssm_read" {
    name = "ssm-read"
    role = aws_iam_role.exec.id
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        Resource = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/aws-docs-graph/prod/*"
      }]
    })
  }

  data "aws_region" "current" {}
  data "aws_caller_identity" "current" {}

  resource "aws_cloudwatch_log_group" "this" {
    name              = "/aws/lambda/${var.function_name}"
    retention_in_days = 14
  }

  resource "aws_lambda_function" "this" {
    function_name = var.function_name
    role          = aws_iam_role.exec.arn
    timeout       = var.timeout
    memory_size   = var.memory_size

    dynamic "snap_start" {
      for_each = var.snap_start ? [1] : []
      content {
        apply_on = "PublishedVersions"
      }
    }

    dynamic "image_config" {
      for_each = var.package_type == "Image" ? [1] : []
      content {}
    }

    package_type = var.package_type

    # Zip-based (Java)
    filename         = var.package_type == "Zip" ? var.filename : null
    handler          = var.package_type == "Zip" ? var.handler : null
    runtime          = var.package_type == "Zip" ? var.runtime : null
    source_code_hash = var.package_type == "Zip" ? var.source_code_hash : null

    # Image-based (Python)
    image_uri = var.package_type == "Image" ? var.image_uri : null

    reserved_concurrent_executions = var.reserved_concurrency

    tracing_config {
      mode = "Active"
    }

    environment {
      variables = var.environment_variables
    }

    depends_on = [aws_cloudwatch_log_group.this]
  }
  ```

  Create `infra/modules/lambda/variables.tf`:
  ```hcl
  variable "function_name"         { type = string }
  variable "timeout"               { type = number; default = 30 }
  variable "memory_size"           { type = number; default = 512 }
  variable "snap_start"            { type = bool;   default = false }
  variable "package_type"          { type = string; default = "Zip" }
  variable "filename"              { type = string; default = null }
  variable "handler"               { type = string; default = null }
  variable "runtime"               { type = string; default = null }
  variable "source_code_hash"      { type = string; default = null }
  variable "image_uri"             { type = string; default = null }
  variable "reserved_concurrency"  { type = number; default = -1 }
  variable "environment_variables" { type = map(string); default = {} }
  ```

  Create `infra/modules/lambda/outputs.tf`:
  ```hcl
  output "function_name"  { value = aws_lambda_function.this.function_name }
  output "function_arn"   { value = aws_lambda_function.this.arn }
  output "invoke_arn"     { value = aws_lambda_function.this.invoke_arn }
  output "role_arn"       { value = aws_iam_role.exec.arn }
  output "role_name"      { value = aws_iam_role.exec.name }
  ```

---

### Task 5: Parameter Store module

- [ ] **Step 1: Create Parameter Store module**

  Create `infra/modules/parameter-store/main.tf`:
  ```hcl
  resource "aws_ssm_parameter" "secrets" {
    for_each = var.parameters

    name  = "/aws-docs-graph/prod/${each.key}"
    type  = "SecureString"
    value = each.value

    lifecycle {
      ignore_changes = [value]  # values are set manually after creation
    }
  }
  ```

  Create `infra/modules/parameter-store/variables.tf`:
  ```hcl
  variable "parameters" {
    type        = map(string)
    description = "Map of parameter name → placeholder value. Real values set manually."
  }
  ```

  Create `infra/modules/parameter-store/outputs.tf`:
  ```hcl
  output "parameter_arns" {
    value = { for k, v in aws_ssm_parameter.secrets : k => v.arn }
  }
  ```

- [ ] **Step 2: Add Parameter Store to prod env**

  Add to `infra/envs/prod/main.tf`:
  ```hcl
  module "secrets" {
    source = "../../modules/parameter-store"
    parameters = {
      "anthropic-api-key"    = "REPLACE_ME"
      "supabase-url"         = "REPLACE_ME"
      "supabase-jwt-secret"  = "REPLACE_ME"
      "supabase-anon-key"    = "REPLACE_ME"
      "database-url-java"    = "REPLACE_ME"
      "database-url-python"  = "REPLACE_ME"
      "neo4j-uri"            = "REPLACE_ME"
      "neo4j-username"       = "REPLACE_ME"
      "neo4j-password"       = "REPLACE_ME"
    }
  }
  ```

  After `terraform apply`, manually update each secret in the AWS console:
  Parameter Store → find `/aws-docs-graph/prod/<name>` → Edit → paste real value.

---

### Task 6: API Gateway + Lambda Authorizer module

- [ ] **Step 1: Create Lambda Authorizer function (inline, tiny)**

  Create `infra/modules/api-gateway/authorizer/index.js`:
  ```javascript
  const { createRemoteJWKSet, jwtVerify } = require('jose');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

  exports.handler = async (event) => {
    const token = event.authorizationToken?.replace('Bearer ', '');
    if (!token) return denyAllPolicy();

    try {
      const { payload } = await jwtVerify(token, JWKS, { algorithms: ['RS256', 'HS256'] });
      return allowPolicy(event.methodArn, payload.sub, payload.email);
    } catch {
      return denyAllPolicy();
    }
  };

  function allowPolicy(methodArn, userId, email) {
    const arnParts = methodArn.split(':');
    const region = arnParts[3];
    const accountId = arnParts[4];
    const apiParts = arnParts[5].split('/');
    const apiId = apiParts[0];
    const stage = apiParts[1];
    return {
      principalId: userId,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'execute-api:Invoke', Resource: `arn:aws:execute-api:${region}:${accountId}:${apiId}/${stage}/*/*` }]
      },
      context: { userId, email }
    };
  }

  function denyAllPolicy() {
    return {
      principalId: 'unauthorized',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Deny', Action: 'execute-api:Invoke', Resource: '*' }]
      }
    };
  }
  ```

  Create `infra/modules/api-gateway/main.tf`:
  ```hcl
  data "archive_file" "authorizer" {
    type        = "zip"
    source_dir  = "${path.module}/authorizer"
    output_path = "${path.module}/authorizer.zip"
  }

  resource "aws_iam_role" "authorizer_exec" {
    name = "${var.api_name}-authorizer-exec"
    assume_role_policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
    })
  }

  resource "aws_iam_role_policy_attachment" "authorizer_basic" {
    role       = aws_iam_role.authorizer_exec.name
    policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  }

  resource "aws_iam_role_policy" "authorizer_ssm" {
    name = "ssm-read"
    role = aws_iam_role.authorizer_exec.id
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/aws-docs-graph/prod/supabase-url"
      }]
    })
  }

  data "aws_region" "current" {}
  data "aws_caller_identity" "current" {}

  resource "aws_cloudwatch_log_group" "authorizer" {
    name              = "/aws/lambda/${var.api_name}-authorizer"
    retention_in_days = 14
  }

  resource "aws_lambda_function" "authorizer" {
    function_name    = "${var.api_name}-authorizer"
    role             = aws_iam_role.authorizer_exec.arn
    handler          = "index.handler"
    runtime          = "nodejs20.x"
    timeout          = 10
    filename         = data.archive_file.authorizer.output_path
    source_code_hash = data.archive_file.authorizer.output_base64sha256
    environment {
      variables = {
        SUPABASE_URL = var.supabase_url
      }
    }
    depends_on = [aws_cloudwatch_log_group.authorizer]
  }

  resource "aws_api_gateway_rest_api" "this" {
    name = var.api_name
    endpoint_configuration { types = ["REGIONAL"] }
  }

  resource "aws_api_gateway_authorizer" "jwt" {
    name                             = "supabase-jwt"
    rest_api_id                      = aws_api_gateway_rest_api.this.id
    authorizer_uri                   = aws_lambda_function.authorizer.invoke_arn
    authorizer_result_ttl_in_seconds = 300
    type                             = "TOKEN"
  }

  resource "aws_lambda_permission" "authorizer_invoke" {
    statement_id  = "AllowAPIGatewayInvoke"
    action        = "lambda:InvokeFunction"
    function_name = aws_lambda_function.authorizer.function_name
    principal     = "apigateway.amazonaws.com"
    source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
  }

  resource "aws_api_gateway_usage_plan" "main" {
    name = "${var.api_name}-usage-plan"
    api_stages {
      api_id = aws_api_gateway_rest_api.this.id
      stage  = aws_api_gateway_stage.prod.stage_name
    }
    throttle_settings {
      rate_limit  = 10
      burst_limit = 20
    }
    quota_settings {
      limit  = 1000
      period = "DAY"
    }
  }

  resource "aws_api_gateway_stage" "prod" {
    rest_api_id   = aws_api_gateway_rest_api.this.id
    deployment_id = aws_api_gateway_deployment.this.id
    stage_name    = "prod"
    xray_tracing_enabled = true
  }

  resource "aws_api_gateway_deployment" "this" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    depends_on  = [aws_api_gateway_authorizer.jwt]

    lifecycle {
      create_before_destroy = true
    }
  }
  ```

  Create `infra/modules/api-gateway/variables.tf`:
  ```hcl
  variable "api_name"    { type = string }
  variable "supabase_url" { type = string }
  variable "java_lambda_invoke_arn" { type = string }
  ```

  Create `infra/modules/api-gateway/outputs.tf`:
  ```hcl
  output "rest_api_id"      { value = aws_api_gateway_rest_api.this.id }
  output "execution_arn"    { value = aws_api_gateway_rest_api.this.execution_arn }
  output "authorizer_id"    { value = aws_api_gateway_authorizer.jwt.id }
  output "invoke_url"       { value = aws_api_gateway_stage.prod.invoke_url }
  ```

---

### Task 7: EventBridge + Budget + SNS alarms

- [ ] **Step 1: Add EventBridge + SNS + Budgets to prod env**

  Add to `infra/envs/prod/main.tf`:
  ```hcl
  # SNS topic for all alerts
  resource "aws_sns_topic" "alerts" {
    name = "${local.name_prefix}-alerts"
  }

  resource "aws_sns_topic_subscription" "email" {
    topic_arn = aws_sns_topic.alerts.arn
    protocol  = "email"
    endpoint  = var.alert_email
  }

  # AWS Budget
  resource "aws_budgets_budget" "monthly" {
    name         = "${local.name_prefix}-monthly"
    budget_type  = "COST"
    limit_amount = "10"
    limit_unit   = "USD"
    time_unit    = "MONTHLY"

    notification {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 50
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
    notification {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 80
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
    notification {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 100
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }

  # Cost Anomaly Detection
  resource "aws_ce_anomaly_monitor" "this" {
    name              = "${local.name_prefix}-anomaly"
    monitor_type      = "DIMENSIONAL"
    monitor_dimension = "SERVICE"
  }

  resource "aws_ce_anomaly_subscription" "this" {
    name      = "${local.name_prefix}-anomaly-sub"
    frequency = "DAILY"
    monitor_arn_list = [aws_ce_anomaly_monitor.this.arn]
    subscriber {
      type    = "SNS"
      address = aws_sns_topic.alerts.arn
    }
    threshold_expression {
      dimension {
        key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
        values        = ["5"]
        match_options = ["GREATER_THAN_OR_EQUAL"]
      }
    }
  }

  # EventBridge: weekly ingest cron
  resource "aws_cloudwatch_event_rule" "ingest_cron" {
    name                = "${local.name_prefix}-ingest-cron"
    schedule_expression = "cron(0 2 ? * MON *)"
    description         = "Weekly AWS docs ingest — Mondays 02:00 UTC"
  }
  ```

---

### Task 8: Run terraform plan + apply

- [ ] **Step 1: Final terraform validate**

  ```bash
  cd infra/envs/prod
  terraform validate
  ```

  Expected: `Success! The configuration is valid.`

- [ ] **Step 2: terraform plan**

  ```bash
  terraform plan -out=tfplan
  ```

  Review the plan output. Expected: ECR repos, Parameter Store secrets, SNS topic, Budget, EventBridge rule, Lambda Authorizer. No Lambda functions yet (api-service and agent-service images don't exist yet).

- [ ] **Step 3: terraform apply**

  ```bash
  terraform apply tfplan
  ```

  Expected: `Apply complete! Resources: N added, 0 changed, 0 destroyed.`

- [ ] **Step 4: Manually set Parameter Store values**

  In AWS console → Systems Manager → Parameter Store:
  For each `/aws-docs-graph/prod/*` parameter, click Edit and paste the real value from your password manager:
  - `anthropic-api-key` → your Anthropic API key
  - `supabase-url` → `https://[ref].supabase.co`
  - `supabase-jwt-secret` → from Supabase dashboard
  - `supabase-anon-key` → from Supabase dashboard
  - `database-url-java` → Supabase pooler connection string (transaction mode)
  - `database-url-python` → Supabase pooler connection string (transaction mode)
  - `neo4j-uri` → bolt URI from AuraDB
  - `neo4j-username` → `neo4j`
  - `neo4j-password` → AuraDB password

- [ ] **Step 5: Verify Parameter Store**

  ```bash
  aws ssm get-parameters-by-path \
    --path "/aws-docs-graph/prod" \
    --with-decryption \
    --profile aws-docs-graph \
    --query "Parameters[].Name"
  ```

  Expected: lists all 9 parameter names.

- [ ] **Step 6: Commit**

  ```bash
  cd ../../..  # back to repo root
  git add infra/
  git commit -m "feat: add Terraform modules and prod env (ECR, params, SNS, Budget, EventBridge)"
  ```

---

### Day 3 Done

Verify:
- [ ] `terraform validate` passes
- [ ] `terraform plan` shows no changes (already applied)
- [ ] Both ECR repos exist in AWS console
- [ ] All 9 Parameter Store secrets have real values
- [ ] AWS Budget `aws-docs-graph-monthly` shows $10 limit with 3 alert thresholds
- [ ] SNS topic exists, email subscription confirmed (check inbox for confirmation email)
- [ ] EventBridge rule `aws-docs-graph-ingest-cron` shows Monday 02:00 UTC schedule
