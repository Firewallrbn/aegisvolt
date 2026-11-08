# Database-per-Service: una tabla por microservicio + una de feature flags, todas con sufijo de ambiente.
# Claves genéricas pk/sk: cada servicio guarda su entidad y sus registros de idempotencia (pk = "saga#<id>").
variable "env" { type = string }
variable "flags" { type = map(bool) }

locals {
  tables = ["reservations", "billing", "dispatch"]
}

resource "aws_dynamodb_table" "service" {
  for_each     = toset(local.tables)
  name         = "aegisvolt-${each.key}-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
}

resource "aws_dynamodb_table" "flags" {
  name         = "aegisvolt-flags-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "name"

  attribute {
    name = "name"
    type = "S"
  }
}

resource "aws_dynamodb_table_item" "flag" {
  for_each   = var.flags
  table_name = aws_dynamodb_table.flags.name
  hash_key   = aws_dynamodb_table.flags.hash_key
  item       = jsonencode({ name = { S = each.key }, enabled = { BOOL = each.value } })

  # Terraform solo siembra el valor inicial; los cambios en caliente no se revierten en el próximo apply
  lifecycle { ignore_changes = [item] }
}

output "table_names" {
  value = merge(
    { for k, t in aws_dynamodb_table.service : k => t.name },
    { flags = aws_dynamodb_table.flags.name },
  )
}
