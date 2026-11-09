terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }

  # Cada workspace guarda su estado en env:/<workspace>/aegisvolt.tfstate
  backend "s3" {
    bucket                      = "aegisvolt-tfstate"
    key                         = "aegisvolt.tfstate"
    region                      = "us-east-1"
    use_lockfile                = true
    use_path_style              = true
    access_key                  = "test"
    secret_key                  = "test"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    endpoints                   = { s3 = "http://localhost:4566" }
  }
}

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    apigatewayv2   = var.aws_endpoint
    cloudwatchlogs = var.aws_endpoint
    dynamodb       = var.aws_endpoint
    ec2            = var.aws_endpoint
    eks            = var.aws_endpoint
    elbv2          = var.aws_endpoint
    iam            = var.aws_endpoint
    s3             = var.aws_endpoint
    sts            = var.aws_endpoint
  }

  default_tags {
    tags = { Project = "aegisvolt", Environment = terraform.workspace, ManagedBy = "terraform" }
  }
}
