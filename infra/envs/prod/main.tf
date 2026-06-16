provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      project     = "aws-docs-graph"
      env         = "prod"
      cost-center = "learning"
    }
  }
}

locals {
  name_prefix = "aws-docs-graph"
}

module "ecr_api" {
  source = "../../modules/ecr"
  name   = "${local.name_prefix}-api-service"
}

module "ecr_agent" {
  source = "../../modules/ecr"
  name   = "${local.name_prefix}-agent-service"
}

module "secrets" {
  source = "../../modules/parameter-store"
  parameters = {
    "anthropic-api-key"   = "REPLACE_ME"
    "supabase-url"        = "REPLACE_ME"
    "supabase-jwt-secret" = "REPLACE_ME"
    "supabase-anon-key"   = "REPLACE_ME"
    "database-url-java"   = "REPLACE_ME"
    "database-url-python" = "REPLACE_ME"
    "neo4j-uri"           = "REPLACE_ME"
    "neo4j-username"      = "REPLACE_ME"
    "neo4j-password"      = "REPLACE_ME"
  }
}
