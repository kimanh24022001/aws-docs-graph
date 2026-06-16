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
