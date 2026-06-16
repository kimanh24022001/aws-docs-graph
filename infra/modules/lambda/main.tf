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
      Resource = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/adg/prod/*"
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
