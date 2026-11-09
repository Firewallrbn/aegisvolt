#!/usr/bin/env bash
# Rastrea una SAGA en CloudWatch: todos los logs de /aegisvolt/<env>/* con ese correlation_id, en orden de tiempo.
# Uso: bash scripts/trace-saga.sh <dev|test|prod> <sagaId>
set -euo pipefail
env=${1:?ambiente}; id=${2:?sagaId}
export MSYS_NO_PATHCONV=1 AWS_ENDPOINT_URL=${AWS_ENDPOINT_URL:-http://localhost:4566} AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-test} \
  AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-test} AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1} AWS_PAGER=""

for g in $(aws logs describe-log-groups --log-group-name-prefix "/aegisvolt/$env/" --query 'logGroups[].logGroupName' --output text); do
  aws logs filter-log-events --log-group-name "$g" --filter-pattern "\"$id\"" --query 'events[].[timestamp,message]' --output text
done | sort -n | cut -f2-
