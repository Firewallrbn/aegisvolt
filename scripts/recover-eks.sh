#!/usr/bin/env bash
# Después de reiniciar Docker, el k3s de Floci no arranca (queda con la IP de nodo vieja).
# Recrea con Terraform solo los clústeres caídos. Uso: bash scripts/recover-eks.sh [dev test prod]
set -euo pipefail
DOCKER=$(command -v docker.exe || command -v docker) # en Git Bash el wrapper "docker" depende de sh
cd "$(dirname "$0")/../infra"
for env in "${@:-dev test prod}"; do
  for e in $env; do
    if [ "$("$DOCKER" inspect -f '{{.State.Running}}' "floci-aws-eks-aegisvolt-$e" 2>/dev/null)" = "true" ]; then
      echo "[$e] clúster corriendo"; continue
    fi
    echo "[$e] clúster caído, recreando..."
    # Floci conserva el volumen de k3s al recrear el clúster, y ese volumen guarda la IP del nodo viejo:
    # el k3s nuevo muere con "failed to find interface with specified node ip". Solo tiene estado del clúster
    # (los datos de la app viven en DynamoDB) y el deploy lo vuelve a poblar.
    "$DOCKER" rm -f "floci-aws-eks-aegisvolt-$e" >/dev/null 2>&1 || true
    "$DOCKER" volume rm "floci-aws-eks-aegisvolt-$e" >/dev/null 2>&1 || true
    terraform init -input=false -reconfigure >/dev/null
    terraform workspace select "$e" >/dev/null
    terraform apply -replace=module.eks.aws_eks_cluster.this -auto-approve -input=false
  done
done
