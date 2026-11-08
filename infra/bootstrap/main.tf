# Bucket del estado remoto. Usa estado local a propósito: no puede guardarse en el bucket que crea.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
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
    s3  = "http://localhost:4566"
    ecr = "http://localhost:4566"
  }
}

# Repositorios ECR compartidos por los 3 ambientes: la misma imagen se promueve dev -> test -> prod
resource "aws_ecr_repository" "service" {
  for_each             = toset(["graphql-gateway", "station-reservation", "billing-wallet", "energy-dispatch"])
  name                 = "aegisvolt/${each.key}"
  image_tag_mutability = "IMMUTABLE" # un tag (sha del commit) siempre apunta a la misma imagen
}

output "ecr_repositories" { value = { for k, r in aws_ecr_repository.service : k => r.repository_url } }

resource "aws_s3_bucket" "tfstate" {
  bucket = "aegisvolt-tfstate"
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration { status = "Enabled" }
}

output "bucket" { value = aws_s3_bucket.tfstate.bucket }
