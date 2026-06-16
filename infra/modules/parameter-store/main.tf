resource "aws_ssm_parameter" "secrets" {
  for_each = var.parameters

  name  = "/aws-docs-graph/prod/${each.key}"
  type  = "SecureString"
  value = each.value

  lifecycle {
    ignore_changes = [value] # values are set manually after creation
  }
}
