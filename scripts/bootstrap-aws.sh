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
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket \
      --bucket "$BUCKET" \
      --region "$REGION" \
      --profile "$PROFILE"
  else
    aws s3api create-bucket \
      --bucket "$BUCKET" \
      --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" \
      --profile "$PROFILE"
  fi

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
