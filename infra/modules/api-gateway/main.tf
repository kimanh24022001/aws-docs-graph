data "archive_file" "authorizer" {
  type        = "zip"
  source_dir  = "${path.module}/authorizer"
  output_path = "${path.module}/authorizer.zip"
}

resource "aws_iam_role" "authorizer_exec" {
  name = "${var.api_name}-authorizer-exec"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
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
  rest_api_id          = aws_api_gateway_rest_api.this.id
  deployment_id        = aws_api_gateway_deployment.this.id
  stage_name           = "prod"
  xray_tracing_enabled = true
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  depends_on  = [aws_api_gateway_authorizer.jwt]

  lifecycle {
    create_before_destroy = true
  }
}
