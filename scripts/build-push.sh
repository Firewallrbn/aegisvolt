#!/usr/bin/env bash
# Construye las 4 imágenes y las sube al ECR de Floci. Uso: bash scripts/build-push.sh <tag>
set -euo pipefail
tag=${1:?uso: build-push.sh <tag>}
DOCKER=$(command -v docker.exe || command -v docker) # en Git Bash el wrapper "docker" depende de sh
cd "$(dirname "$0")/.."

# Floci guarda cada repo ECR en su registry interno (puerto 5100) bajo <cuenta>/<región>/<repo>.
# El clúster la descarga con el nombre ECR normal: 000000000000.dkr.ecr.us-east-1.localhost:4566/aegisvolt/<servicio>
push_prefix=localhost:5100/000000000000/us-east-1/aegisvolt
for s in graphql-gateway station-reservation billing-wallet energy-dispatch; do
  echo "== $s:$tag"
  "$DOCKER" build -q --build-arg SERVICE="$s" -t "$push_prefix/$s:$tag" services
  "$DOCKER" push -q "$push_prefix/$s:$tag"
done
