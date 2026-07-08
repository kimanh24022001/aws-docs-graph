resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = "${local.name_prefix}-operations"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title = "Query Rate"
          metrics = [
            ["AwsDocsGraph", "query_count", "status", "succeeded"],
            [".", ".", "status", "failed"],
            [".", ".", "status", "degraded"]
          ]
          period = 300
          stat   = "Sum"
          view   = "timeSeries"
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title = "Query Duration p50/p99 (ms)"
          metrics = [
            ["AwsDocsGraph", "query_duration_ms", { "stat" = "p50", "label" = "p50" }],
            ["...", { "stat" = "p99", "label" = "p99" }]
          ]
          period = 300
          view   = "timeSeries"
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title = "Lambda Duration"
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", "${local.name_prefix}-agent-service", { "stat" = "p99", "label" = "p99" }],
            ["...", { "stat" = "Average", "label" = "avg" }]
          ]
          period = 300
          view   = "timeSeries"
          region = var.aws_region
        }
      }
    ]
  })
}

resource "aws_cloudwatch_dashboard" "cost" {
  dashboard_name = "${local.name_prefix}-cost"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 24
        height = 6
        properties = {
          title = "Daily LLM Cost (USD)"
          metrics = [
            ["AwsDocsGraph", "llm_cost_usd", "source", "agent"]
          ]
          period = 86400
          stat   = "Sum"
          view   = "timeSeries"
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title = "Query Count by Status"
          metrics = [
            ["AwsDocsGraph", "query_count", "status", "succeeded"],
            [".", ".", "status", "degraded"],
            [".", ".", "status", "failed"]
          ]
          period = 86400
          stat   = "Sum"
          view   = "timeSeries"
          region = var.aws_region
        }
      }
    ]
  })
}
