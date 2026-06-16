terraform {
  required_version = ">= 1.8"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  backend "s3" {
    bucket         = "aws-docs-graph-tfstate-123456789012" # replace with your account ID
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "aws-docs-graph-tfstate-lock"
    encrypt        = true
  }
}
