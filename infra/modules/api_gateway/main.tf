# Entrada pública -> privada: API Gateway (HTTP API) -> VPC Link -> NLB interno -> Ingress/pods del EKS.
# El NLB vive en subredes privadas; el target group (tipo ip) recibe las IPs de los pods del gateway GraphQL.
variable "env" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }

variable "graphql_port" {
  type    = number
  default = 4000
}

resource "aws_lb" "internal" {
  name               = "aegisvolt-${var.env}-nlb"
  internal           = true
  load_balancer_type = "network"
  subnets            = var.subnet_ids
}

resource "aws_lb_target_group" "graphql" {
  name        = "aegisvolt-${var.env}-graphql"
  port        = var.graphql_port
  protocol    = "TCP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    protocol = "HTTP"
    path     = "/health"
  }
}

resource "aws_lb_listener" "graphql" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.graphql.arn
  }
}

data "aws_vpc" "this" { id = var.vpc_id }

# Las ENIs del VPC Link solo pueden hablar con el listener del NLB dentro de la VPC
resource "aws_security_group" "vpc_link" {
  name        = "aegisvolt-${var.env}-vpclink"
  description = "Salida del VPC Link hacia el NLB interno"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.this.cidr_block]
  }
}

resource "aws_apigatewayv2_vpc_link" "this" {
  name               = "aegisvolt-${var.env}"
  subnet_ids         = var.subnet_ids
  security_group_ids = [aws_security_group.vpc_link.id]
}

resource "aws_apigatewayv2_api" "this" {
  name          = "aegisvolt-${var.env}"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "graphql" {
  api_id             = aws_apigatewayv2_api.this.id
  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  integration_uri    = aws_lb_listener.graphql.arn
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.this.id
}

resource "aws_apigatewayv2_route" "graphql" {
  for_each  = toset(["ANY /graphql", "GET /health"])
  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.graphql.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true
}

output "api_endpoint" { value = aws_apigatewayv2_api.this.api_endpoint }
output "target_group_arn" { value = aws_lb_target_group.graphql.arn }
