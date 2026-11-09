variable "aws_endpoint" {
  description = "Endpoint de Floci"
  type        = string
  default     = "http://localhost:4566"
}

locals {
  env      = terraform.workspace
  services = ["graphql-gateway", "station-reservation", "billing-wallet", "energy-dispatch"]

  # CIDR distinto por ambiente: las VPC nunca se solapan
  vpc_cidr = { dev = "10.10.0.0/16", test = "10.20.0.0/16", prod = "10.30.0.0/16" }

  # Estado inicial de las flags; después se cambian en caliente en DynamoDB
  flags = {
    ENABLE_DYNAMIC_SURGE_PRICING    = { dev = true, test = true, prod = false }
    ENABLE_FAST_CHARGE_BOOST        = { dev = true, test = true, prod = false }
    SIMULATE_CHARGER_HARDWARE_FAULT = { dev = false, test = false, prod = false }
  }
}

# Impide aplicar en el workspace "default" o en uno desconocido
resource "terraform_data" "workspace_guard" {
  lifecycle {
    precondition {
      condition     = contains(["dev", "test", "prod"], local.env)
      error_message = "Selecciona un workspace válido: terraform workspace select dev|test|prod"
    }
  }
}

module "network" {
  source   = "./modules/network"
  env      = local.env
  vpc_cidr = lookup(local.vpc_cidr, local.env, "10.99.0.0/16")
}

module "dynamodb" {
  source = "./modules/dynamodb"
  env    = local.env
  flags  = { for name, per_env in local.flags : name => lookup(per_env, local.env, false) }
}

module "eks" {
  source     = "./modules/eks"
  env        = local.env
  subnet_ids = module.network.private_subnet_ids
}

module "api_gateway" {
  source     = "./modules/api_gateway"
  env        = local.env
  vpc_id     = module.network.vpc_id
  subnet_ids = module.network.private_subnet_ids
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = toset(local.services)
  name              = "/aegisvolt/${local.env}/${each.key}"
  retention_in_days = 14
}

output "env" { value = local.env }
output "vpc_id" { value = module.network.vpc_id }
output "tables" { value = module.dynamodb.table_names }
output "eks_cluster" { value = module.eks.cluster_name }
output "api_endpoint" { value = module.api_gateway.api_endpoint }
output "nlb_target_group_arn" { value = module.api_gateway.target_group_arn }
output "log_groups" { value = [for g in aws_cloudwatch_log_group.service : g.name] }
