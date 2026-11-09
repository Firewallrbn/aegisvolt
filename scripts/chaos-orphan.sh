#!/usr/bin/env bash
# Caos para la defensa: simula que el gateway murió justo después de registrar una SAGA (RUNNING, sin pasos).
# El siguiente run del flujo de Prefect la marca como huérfana y termina en Failed.
# Uso: bash scripts/chaos-orphan.sh <env>          -> crea la huérfana
#      bash scripts/chaos-orphan.sh <env> --clean  -> la marca COMPENSATED (no aplicó ningún paso)
set -euo pipefail
env=${1:?ambiente}
export AWS_ENDPOINT_URL=${AWS_ENDPOINT_URL:-http://localhost:4566} AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-test} \
  AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-test} AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1} AWS_PAGER=""
t=aegisvolt-sagas-$env

if [ "${2:-}" = --clean ]; then
  for id in $(aws dynamodb scan --table-name "$t" --filter-expression 'simulated = :y AND #s = :r' \
      --expression-attribute-names '{"#s":"status"}' --expression-attribute-values '{":y":{"BOOL":true},":r":{"S":"RUNNING"}}' \
      --query 'Items[].id.S' --output text); do
    aws dynamodb update-item --table-name "$t" --key "{\"id\":{\"S\":\"$id\"}}" --update-expression 'SET #s = :c' \
      --expression-attribute-names '{"#s":"status"}' --expression-attribute-values '{":c":{"S":"COMPENSATED"}}'
    echo "$id -> COMPENSATED"
  done
  exit
fi

id=chaos-$(date +%s)
created=$(date -u -d '-10 minutes' +%FT%T.000Z)
aws dynamodb put-item --table-name "$t" --item "{\"id\":{\"S\":\"$id\"},\"status\":{\"S\":\"RUNNING\"},\"simulated\":{\"BOOL\":true},
  \"stationId\":{\"S\":\"st-norte\"},\"connectorId\":{\"S\":\"c1\"},\"fleetId\":{\"S\":\"fleet-andina\"},\"kwh\":{\"N\":\"10\"},
  \"steps\":{\"L\":[]},\"createdAt\":{\"S\":\"$created\"}}"
echo "SAGA huérfana simulada: $id (RUNNING desde $created)"
