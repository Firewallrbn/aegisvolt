#!/usr/bin/env bash
# Despliega los 4 servicios en el EKS de un ambiente y conecta el gateway al NLB del API Gateway.
# Uso: bash scripts/deploy.sh <dev|test|prod> <tag>
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash no debe reescribir rutas tipo /health
env=${1:?uso: deploy.sh <dev|test|prod> <tag>}
tag=${2:?uso: deploy.sh <dev|test|prod> <tag>}
case $env in dev|test|prod) ;; *) echo "ambiente inválido: $env" >&2; exit 1 ;; esac

cd "$(dirname "$0")/.."
DOCKER=$(command -v docker.exe || command -v docker)
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 AWS_PAGER=""
services="graphql-gateway station-reservation billing-wallet energy-dispatch"
registry=000000000000.dkr.ecr.us-east-1.localhost:4566/aegisvolt
kube=$(bash scripts/kubeconfig.sh "$env")
k() { kubectl --kubeconfig "$kube" -n aegisvolt "$@"; }

# Kustomization temporal = overlay del ambiente + tag de imagen de este despliegue
build=k8s/.build/$env
mkdir -p "$build"
{
  echo "resources: [../../overlays/$env]"
  echo "images:"
  for s in $services; do echo "  - { name: $s, newName: $registry/$s, newTag: \"$tag\" }"; done
} > "$build/kustomization.yaml"
kubectl --kubeconfig "$kube" apply -k "$build"
for s in $services; do k rollout status "deploy/$s" --timeout=180s; done

# NLB: el target es la IP del nodo dentro de la VPC del ambiente + NodePort 30400 del gateway
cd infra
terraform workspace select "$env" >/dev/null
tg=$(terraform output -raw nlb_target_group_arn)
vpc=$(terraform output -raw vpc_id)
api=$(terraform output -raw api_endpoint)
cd ..
node_ip=$("$DOCKER" inspect -f "{{(index .NetworkSettings.Networks \"floci-aws-vpc-4566-us-east-1-$vpc\").IPAddress}}" "floci-aws-eks-aegisvolt-$env")
# Si el clúster se recreó, el nodo cambió de IP: se sacan los targets viejos
for old in $(aws elbv2 describe-target-health --target-group-arn "$tg" --query "TargetHealthDescriptions[?Target.Id!='$node_ip'].Target.Id" --output text); do
  aws elbv2 deregister-targets --target-group-arn "$tg" --targets "Id=$old,Port=30400"
done
aws elbv2 register-targets --target-group-arn "$tg" --targets "Id=$node_ip,Port=30400"

api_id=${api#https://}
echo "OK [$env] $tag -> GraphQL: http://localhost:4566/execute-api/${api_id%%.*}/\$default/graphql"
