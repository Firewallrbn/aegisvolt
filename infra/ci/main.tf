# Tablas efímeras para los tests de PR (aegisvolt-*-ci). Reusa el mismo módulo que los ambientes reales,
# así los tests de integración y E2E nunca tocan datos de dev/test/prod. Estado local: se crea y destruye por job.
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
  endpoints { dynamodb = "http://localhost:4566" }
}

module "dynamodb" {
  source = "../modules/dynamodb"
  env    = "ci"
  # SIMULATE_CHARGER_HARDWARE_FAULT empieza apagada; los tests la prenden y la apagan
  flags = {
    ENABLE_DYNAMIC_SURGE_PRICING    = false
    ENABLE_FAST_CHARGE_BOOST        = true
    SIMULATE_CHARGER_HARDWARE_FAULT = false
  }
}
