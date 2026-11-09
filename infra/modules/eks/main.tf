# Clúster EKS por ambiente, en subredes privadas y sin endpoint público.
# En Floci se materializa como un contenedor k3s (floci-aws-eks-<nombre>).
# shortcut: sin aws_eks_node_group, Floci no lo emula y el nodo k3s ya ejecuta pods; agregarlo si se pasa a AWS real.
variable "env" { type = string }
variable "subnet_ids" { type = list(string) }

resource "aws_iam_role" "cluster" {
  name = "aegisvolt-${var.env}-eks-cluster"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "eks.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_eks_cluster" "this" {
  name     = "aegisvolt-${var.env}"
  role_arn = aws_iam_role.cluster.arn

  vpc_config {
    subnet_ids              = var.subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = false
  }

  depends_on = [aws_iam_role_policy_attachment.cluster]
}

output "cluster_name" { value = aws_eks_cluster.this.name }
