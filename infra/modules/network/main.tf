# VPC por ambiente: 2 subredes públicas (IGW) y 2 privadas sin NAT.
# Las privadas llegan a AWS solo por VPC Endpoints: el tráfico nunca sale a internet.
variable "env" { type = string }
variable "vpc_cidr" { type = string }

locals {
  azs = ["us-east-1a", "us-east-1b"]
  # Endpoints de interfaz: logs (CloudWatch), execute-api (API Gateway privado),
  # ecr.api/ecr.dkr (descarga de imágenes) y sts (credenciales de los pods)
  interface_endpoints = ["logs", "execute-api", "ecr.api", "ecr.dkr", "sts"]
}

data "aws_region" "current" {}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "aegisvolt-${var.env}" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "aegisvolt-${var.env}-igw" }
}

resource "aws_subnet" "public" {
  count                   = length(local.azs)
  vpc_id                  = aws_vpc.this.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  map_public_ip_on_launch = true
  tags                    = { Name = "aegisvolt-${var.env}-public-${count.index}", Tier = "public" }
}

resource "aws_subnet" "private" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.this.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  tags              = { Name = "aegisvolt-${var.env}-private-${count.index}", Tier = "private" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "aegisvolt-${var.env}-public" }
}

# Sin ruta 0.0.0.0/0: solo la ruta local de la VPC + prefijos de S3/DynamoDB vía gateway endpoints
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "aegisvolt-${var.env}-private" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Gateway endpoints: agregan rutas a la tabla privada hacia S3 y DynamoDB
resource "aws_vpc_endpoint" "gateway" {
  for_each          = toset(["s3", "dynamodb"])
  vpc_id            = aws_vpc.this.id
  vpc_endpoint_type = "Gateway"
  service_name      = "com.amazonaws.${data.aws_region.current.region}.${each.key}"
  route_table_ids   = [aws_route_table.private.id]
  tags              = { Name = "aegisvolt-${var.env}-vpce-${each.key}" }
}

resource "aws_security_group" "endpoints" {
  name        = "aegisvolt-${var.env}-vpce"
  description = "HTTPS desde la VPC hacia los interface endpoints"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

# Interface endpoints: una ENI privada por subred, con DNS privado
resource "aws_vpc_endpoint" "interface" {
  for_each            = toset(local.interface_endpoints)
  vpc_id              = aws_vpc.this.id
  vpc_endpoint_type   = "Interface"
  service_name        = "com.amazonaws.${data.aws_region.current.region}.${each.key}"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true
  tags                = { Name = "aegisvolt-${var.env}-vpce-${each.key}" }
}

output "vpc_id" { value = aws_vpc.this.id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "public_subnet_ids" { value = aws_subnet.public[*].id }
