# Guía de defensa

Cada pregunta del banco (sección 6 de la especificación) con su respuesta corta y la demo. Antes de empezar:

```bash
docker compose up -d && bash scripts/recover-eks.sh dev prod
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 AWS_PAGER="" MSYS_NO_PATHCONV=1
cd frontend && npm run dev            # http://localhost:5173
cd observability && .venv/Scripts/prefect server start   # http://127.0.0.1:4200
```

---

## 6.1 Infraestructura, S3 y redes (30%)

### ¿Cómo garantiza que un `apply` en `test` no sobrescriba `prod`?

- Cada ambiente es un **workspace** con su propio state: `env:/test/aegisvolt.tfstate` y `env:/prod/aegisvolt.tfstate`. Terraform solo modifica lo que está en el state del workspace activo.
- Todos los nombres llevan `terraform.workspace` (`aegisvolt-billing-test`, VPC `10.20/16`…): no hay recursos compartidos.
- `workspace_guard` aborta si el workspace no es dev/test/prod.
- En el pipeline, el workspace sale de la rama mergeada (`github.ref_name`): un merge a `test` no puede seleccionar `prod`.

```bash
cd infra && terraform workspace list
MSYS_NO_PATHCONV=1 aws s3 ls s3://aegisvolt-tfstate --recursive     # un state por ambiente
```

### Versiones del state de `dev` y cómo restaurar

```bash
aws s3api list-object-versions --bucket aegisvolt-tfstate --prefix env:/dev/ \
  --query 'Versions[].[VersionId,LastModified,IsLatest]' --output table
aws s3api copy-object --bucket aegisvolt-tfstate --key env:/dev/aegisvolt.tfstate \
  --copy-source "aegisvolt-tfstate/env:/dev/aegisvolt.tfstate?versionId=<id-bueno>"
terraform workspace select dev && terraform plan     # confirmar
```

Copiar la versión buena sobre la clave la vuelve la más reciente; la corrupta queda como una versión más, así que no se pierde nada. Detalle en [Infraestructura](infraestructura.md#restaurar-una-versión-anterior-state-corrupto).

### Recorrido de un paquete de API Gateway al pod

API Gateway → integración `VPC_LINK` → VPC Link (SG: salida solo 80 al CIDR de la VPC) → NLB interno en subred privada → target `IP del nodo:30400` → Service NodePort → pod. Desde el pod a DynamoDB: la **tabla de rutas privada** (sin `0.0.0.0/0`) tiene el prefijo de DynamoDB por el **gateway endpoint**; CloudWatch y ECR van por **interface endpoints** con el SG que solo permite 443 desde la VPC. Diagrama en [Arquitectura](arquitectura.md#red-recorrido-de-un-paquete).

```bash
aws ec2 describe-vpc-endpoints --query 'VpcEndpoints[].[Tags[?Key==`Name`]|[0].Value,VpcEndpointType]' --output table
aws ec2 describe-route-tables --filters Name=tag:Name,Values=aegisvolt-dev-private --query 'RouteTables[].Routes'
```

---

## 6.2 CI/CD, promoción y canary (25%)

### Push directo o force push a `test`

```bash
git push origin HEAD:test            # → "Changes must be made through a pull request"
git push --force origin HEAD:test    # → también rechazado (non_fast_forward)
```

Regla: ruleset `proteger-ambientes` en GitHub → Settings → Rules. Prohíbe push directo, force push y borrado, y exige 6 checks en verde. No tiene excepciones.

### ¿Cómo se elige el ambiente del `terraform apply` en el YAML?

`.github/workflows/deploy.yml`: se dispara con `push` a `dev|test|prod` (el push que deja el merge) y usa `ENVIRONMENT: ${{ github.ref_name }}` → `terraform workspace select "$ENVIRONMENT"` → `apply`. El `plan` del PR usa la rama destino: `github.base_ref`.

### ¿Qué métrica evalúa el canary antes de pasar de 20% a 100%?

AnalysisTemplate `canary-health`: 6 consultas a `/health` de los pods canary (Service `-canary`), una cada 5 s. Condición `result.ok == true` y `failureLimit: 0`: un solo fallo aborta y Argo hace rollback. Además, `progressDeadlineSeconds: 90` aborta si el canary no arranca. Diagrama en [CI/CD](cicd.md#canary-deployment).

```bash
KC=$(bash scripts/kubeconfig.sh dev)
kubectl --kubeconfig "$KC" -n aegisvolt get rollouts
kubectl --kubeconfig "$KC" -n aegisvolt get analysisruns
```

---

## 6.3 SAGA y feature flags (25%)

### Flag de falla en `test` + reserva + compensación en DynamoDB

1. Frontend → ambiente **test** → Feature flags → encender **Falla física simulada**.
2. Mapa → Estación Sur → **Reservar y cargar** con `fleet-andina`.
3. La SAGA termina **Compensada**: Reserva ✓, Cobro ✓, Activación ✕, y debajo ↺ Cobro, ↺ Reserva.
4. Mostrarlo en las tablas (usar el id de la SAGA):

```bash
ID=<sagaId>
aws dynamodb get-item --table-name aegisvolt-sagas-test --key "{\"id\":{\"S\":\"$ID\"}}"                 # bitácora
aws dynamodb query --table-name aegisvolt-billing-test --key-condition-expression 'pk = :p' \
  --expression-attribute-values "{\":p\":{\"S\":\"SAGA#$ID\"}}"                                          # CHARGE + REFUND
aws dynamodb query --table-name aegisvolt-reservations-test --key-condition-expression 'pk = :p' \
  --expression-attribute-values "{\":p\":{\"S\":\"SAGA#$ID\"}}"                                          # RESERVE + RELEASE
aws dynamodb get-item --table-name aegisvolt-billing-test --key '{"pk":{"S":"WALLET#fleet-andina"},"sk":{"S":"BALANCE"}}'   # saldo intacto
```

5. Apagar la flag al terminar.

### ¿Cómo evita problemas de idempotencia si una compensación se procesa dos veces?

Cada efecto se escribe en la misma `TransactWriteItems` que un marcador `SAGA#<id>/<PASO>` con `attribute_not_exists`. Un duplicado falla la condición del marcador, la transacción entera se cancela (no se vuelve a reembolsar) y el servicio devuelve el resultado original. Si falla sin que exista el marcador, es una regla de negocio real (402/409). Detalle en [SAGA](saga.md#idempotencia).

Demo: repetir el reembolso de la SAGA anterior; el saldo no cambia.

```bash
curl -s -X POST localhost:5173/gw/test/graphql -H 'content-type: application/json' \
  -d '{"query":"{ wallet(fleetId:\"fleet-andina\") { balance } }"}'
```

---

## 6.4 Observabilidad y frontend (20%)

### Prefect + `correlation_id` de una SAGA fallida en CloudWatch

1. Dashboard de Prefect → correr el flujo (`python flow.py`) → Runs (estado) y Artifacts (tabla de salud por ambiente + inconsistencias).
2. Opcional: `bash scripts/chaos-orphan.sh dev` → correr el flujo → **Failed** con la huérfana detectada → `--clean`.
3. Tomar el id de una SAGA compensada (panel de compensaciones del frontend) y:

```bash
bash scripts/trace-saga.sh test <sagaId>
```

Muestra en orden los logs de los 4 servicios con ese `correlation_id`, sacados de `/aegisvolt/test/*`.

### Cambiar una flag en `dev` sin redesplegar y ver que `prod` no cambia

1. Frontend en **dev** → Estación Norte: el conector C2 (150 kW) se puede reservar.
2. Apagar **Ultra-carga** en dev → C2 aparece al instante como "Ultra apagada".
3. Cambiar el selector a **prod**: Ultra-carga sigue con su propio valor y nada cambió.
4. Volver a encenderla en dev.

Funciona porque cada ambiente tiene su tabla `aegisvolt-flags-<env>` y los servicios leen la flag en cada petición, sin caché ni redespliegue.
