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

# Estado y pasos de cada SAGA, escrito por el orquestador (graphql-gateway)
resource "aws_dynamodb_table" "sagas" {
  name         = "aegisvolt-sagas-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

locals {
  # "estación/conector" => potencia. El de 150 kW es ultra-carga (requiere ENABLE_FAST_CHARGE_BOOST)
  connectors = {
    "st-norte/c1" = 50
    "st-norte/c2" = 150
    "st-sur/c1"   = 50
    "st-sur/c2"   = 50
  }
  # fleet-sin-saldo existe para demostrar la compensación del paso 2
  wallets = { "fleet-andina" = 500, "fleet-sin-saldo" = 5 }
}

resource "aws_dynamodb_table_item" "connector" {
  for_each   = local.connectors
  table_name = aws_dynamodb_table.service["reservations"].name
  hash_key   = "pk"
  range_key  = "sk"
  item = jsonencode({
    pk      = { S = "STATION#${split("/", each.key)[0]}" }
    sk      = { S = "CONNECTOR#${split("/", each.key)[1]}" }
    status  = { S = "AVAILABLE" }
    powerKw = { N = tostring(each.value) }
    ultra   = { BOOL = each.value >= 150 }
  })
  lifecycle { ignore_changes = [item] } # los servicios cambian el estado; Terraform solo siembra
}

resource "aws_dynamodb_table_item" "wallet" {
  for_each   = local.wallets
  table_name = aws_dynamodb_table.service["billing"].name
  hash_key   = "pk"
  range_key  = "sk"
  item = jsonencode({
    pk      = { S = "WALLET#${each.key}" }
    sk      = { S = "BALANCE" }
    balance = { N = tostring(each.value) }
  })
  lifecycle { ignore_changes = [item] }
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
    { flags = aws_dynamodb_table.flags.name, sagas = aws_dynamodb_table.sagas.name },
  )
}
