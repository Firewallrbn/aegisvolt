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
    terraform workspace select "$e" >/dev/null
    terraform apply -replace=module.eks.aws_eks_cluster.this -auto-approve -input=false
  done
done
