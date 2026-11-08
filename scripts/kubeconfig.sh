#!/usr/bin/env bash
# Genera el kubeconfig del EKS de Floci para un ambiente. Uso: bash scripts/kubeconfig.sh dev
# El token de "aws eks get-token" no lo acepta el k3s de Floci: se usa la credencial interna de k3s.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash convertiría /etc/rancher/... en ruta de Windows
env=${1:?uso: kubeconfig.sh dev|test|prod}
DOCKER=$(command -v docker.exe || command -v docker) # en Git Bash el wrapper "docker" depende de sh
c=floci-aws-eks-aegisvolt-$env
port=$("$DOCKER" port "$c" 6443 | head -1 | sed 's/.*://') # el puerto cambia cada vez que se recrea el clúster
out=${KUBECONFIG_DIR:-$HOME/.kube}/aegisvolt-$env
mkdir -p "$(dirname "$out")"
"$DOCKER" exec "$c" cat /etc/rancher/k3s/k3s.yaml | sed "s#127.0.0.1:6443#127.0.0.1:$port#; s#: default\$#: aegisvolt-$env#" > "$out"
command -v cygpath >/dev/null && cygpath -m "$out" || echo "$out" # C:/... para el kubectl.exe de Windows
