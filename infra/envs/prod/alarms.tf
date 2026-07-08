locals {
  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "llm_cost_high" {
  alarm_name          = "${local.name_prefix}-llm-cost-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "llm_cost_usd"
  namespace           = "AwsDocsGraph"
  period              = 86400
  statistic           = "Sum"
  threshold           = 1.0
  alarm_description   = "Daily LLM cost > $1"
  alarm_actions       = local.alarm_actions
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "query_failures" {
  alarm_name          = "${local.name_prefix}-query-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "query_count"
  namespace           = "AwsDocsGraph"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Query failure rate high"
  alarm_actions       = local.alarm_actions
  treat_missing_data  = "notBreaching"

  dimensions = {
    status = "failed"
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_p99" {
  alarm_name          = "${local.name_prefix}-lambda-p99"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  extended_statistic  = "p99"
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  threshold           = 25000
  alarm_description   = "Lambda p99 > 25s"
  alarm_actions       = local.alarm_actions
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = "${local.name_prefix}-agent-service"
  }
}
