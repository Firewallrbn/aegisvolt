# Operación

Comandos para **Git Bash** en Windows, desde la raíz del repo, salvo que se indique otra cosa.

```bash
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
       AWS_DEFAULT_REGION=us-east-1 AWS_PAGER="" MSYS_NO_PATHCONV=1
```

## Desde cero

| # | Paso | Comando |
|---|---|---|
| 1 | Floci | `docker compose up -d` (verificar: `bash scripts/verify-floci.sh`) |
| 2 | Bucket de state + ECR | `terraform -chdir=infra/bootstrap init && terraform -chdir=infra/bootstrap apply` |
| 3 | Ambientes | `cd infra && terraform init && for e in dev test prod; do terraform workspace new $e; done` |
| 4 | Infra de un ambiente | `terraform workspace select dev && terraform apply` |
| 5 | Imágenes | `bash scripts/build-push.sh <tag>` |
| 6 | Despliegue canary | `bash scripts/deploy.sh dev <tag>` (instala Argo Rollouts si falta) |
| 7 | Frontend | `cd frontend && npm install && npm run dev` |
| 8 | Prefect | ver [Observabilidad](observabilidad.md#ejecutar) |
| 9 | Runner de CI | `powershell -File scripts/start-runner.ps1` |

En el día a día, los pasos 4 a 6 los hace el pipeline al mergear un PR.

## Después de reiniciar el PC

Floci guarda su estado en el volumen `floci-data` (`FLOCI_STORAGE_MODE=hybrid`), pero los contenedores k3s de EKS no siempre sobreviven a un reinicio de Docker.

```bash
docker compose up -d                       # Floci (tiene restart: unless-stopped)
bash scripts/recover-eks.sh dev            # recrea el clúster si su contenedor no corre
bash scripts/deploy.sh dev <tag>           # vuelve a desplegar y registra el nodo en el NLB
powershell -File scripts/start-runner.ps1  # runner de GitHub Actions
```

El último tag desplegado es el hash del árbol de servicios: `git rev-parse --short=12 HEAD:services`.

## RAM

Cada clúster k3s usa ~1.2 GB. En un PC de 16 GB conviene tener **uno o dos ambientes encendidos a la vez**:

```bash
docker stop floci-aws-eks-aegisvolt-test    # apagar un ambiente (la infra y los datos quedan)
bash scripts/recover-eks.sh test            # volver a encenderlo
```

## kubectl

```bash
KC=$(bash scripts/kubeconfig.sh dev)       # escribe ~/.kube/aegisvolt-dev con el puerto actual
kubectl --kubeconfig "$KC" -n aegisvolt get rollouts,pods
kubectl --kubeconfig "$KC" -n aegisvolt get rollout graphql-gateway -o jsonpath='{.status.phase}'
```

## Scripts

| Script | Qué hace |
|---|---|
| `verify-floci.sh` | 22 chequeos de que Floci emula lo que el proyecto usa |
| `kubeconfig.sh <env>` | kubeconfig del clúster k3s de ese ambiente |
| `recover-eks.sh [envs]` | recrea con Terraform el clúster si su contenedor no corre |
| `build-push.sh <tag>` | construye y sube las 4 imágenes a ECR |
| `deploy.sh <env> <tag>` | canary de los 4 servicios, espera el resultado y registra el nodo en el NLB |
| `trace-saga.sh <env> <id>` | logs de una SAGA en CloudWatch, en orden |
| `chaos-orphan.sh <env> [--clean]` | crea / limpia una SAGA huérfana simulada |
| `start-runner.ps1` | arranca el runner self-hosted |

## Problemas conocidos

| Síntoma | Causa | Solución |
|---|---|---|
| `bash` falla con un error de WSL en el runner | Windows resuelve `bash` al de WSL | `start-runner.ps1` pone Git Bash primero en el PATH |
| `docker` falla en Git Bash | el wrapper `docker` de Git Bash depende de `sh` | los scripts usan `docker.exe` |
| Rutas `/aegisvolt/...` se convierten en `C:/Program Files/Git/...` | conversión de rutas de MSYS | `export MSYS_NO_PATHCONV=1` |
| `kubectl` no conecta tras recrear el clúster | el puerto del API server cambia | volver a correr `kubeconfig.sh` |
| API Gateway responde 503 | el ambiente está apagado o el NLB no tiene target | `recover-eks.sh` + `deploy.sh` |
| El contenedor k3s sale con `failed to find interface with specified node ip` | Floci conserva el volumen de k3s al recrear el clúster y ese volumen guarda la IP del nodo anterior | `recover-eks.sh` ya borra contenedor y volumen antes de recrear (solo tienen estado del clúster; los datos están en DynamoDB) |
| `git push` falla en Git Bash | el helper de credenciales necesita `sh` | hacer el push desde PowerShell |
