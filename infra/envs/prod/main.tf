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
  name             = "${local.name_prefix}-anomaly-sub"
  frequency        = "DAILY"
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
