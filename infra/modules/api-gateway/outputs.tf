output "rest_api_id" { value = aws_api_gateway_rest_api.this.id }
output "execution_arn" { value = aws_api_gateway_rest_api.this.execution_arn }
output "authorizer_id" { value = aws_api_gateway_authorizer.jwt.id }
output "invoke_url" { value = aws_api_gateway_stage.prod.invoke_url }
