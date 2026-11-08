# Especificación del Proyecto Final: AegisVolt

**Plataforma Cloud-Native de Gestión de Carga para Flotas Eléctricas y Electrolineras**

| | |
|---|---|
| **Asignatura** | Patrones Arquitectónicos Avanzados |
| **Modalidad** | Entrega Individual |
| **Duración Estimada** | 2 semanas calendario (14 días) |
| **Evaluación** | Sustentación oral basada en preguntas directas del profesor (Correcto / Incorrecto) por capa arquitectónica |

---

## 1. Contexto de Negocio y Caso de Estudio: AegisVolt

### 1.1 Sector y Nicho de Mercado Objetivo

- **Sector:** Movilidad Eléctrica Inteligente (e-Mobility), Smart Grids y Logística de Última Milla.
- **Nicho de Mercado:** Operadores de flotas comerciales de vehículos eléctricos (EV) de reparto urbano y administradores de estaciones de carga rápida (electrolineras B2B) en Latinoamérica.
- **Problema de Negocio:** A medida que las empresas de logística migran sus flotas hacia vehículos eléctricos, se enfrentan a cuellos de botella críticos en la reserva de conectores de carga de alta potencia, fallos en el cobro distribuido cuando una bahía presenta averías físicas, falta de visibilidad sobre la telemetría de consumo energético e inestabilidad al desplegar nuevas funcionalidades de software en las estaciones activas.

### 1.2 Necesidad a Resolver

Diseñar, aprovisionar y desplegar **AegisVolt**, una plataforma web distribuida y resiliente que permita a los operadores de flotas reservar bahías de carga, autorizar retenciones de saldo, activar sesiones de transferencia de energía y auditar telemetría en tiempo real. La plataforma debe operar bajo estrictos estándares de aislamiento multi-ambiente (`dev`, `test`, `prod`), infraestructura inmutable como código (IaC), despliegues progresivos sin tiempo de caída y consistencia eventual mediante transacciones compensatorias.

---

## 2. Arquitectura Técnica y Stack Tecnológico Requerido

```
                                [ CLIENTE / UI FRONTEND ]
                                            │
                                            │ (HTTPS / WSS)
                                            ▼
                                   [ API GATEWAY AWS ]
                                            │
                                            │ (VPC Endpoint Privado)
                                            ▼
                   ┌─────────────────────────────────────────────────┐
                   │           EKS CLUSTER (KUBERNETES)              │
                   │                                                 │
                   │  ┌───────────────────────────────────────────┐  │
                   │  │         GRAPHQL AGGREGATION LAYER         │  │
                   │  └────────────────────┬──────────────────────┘  │
                   │                       │                         │
                   │        ┌──────────────┼──────────────┐          │
                   │        ▼              ▼              ▼          │
                   │  ┌───────────┐  ┌───────────┐  ┌───────────┐    │
                   │  │ Station   │  │ Billing   │  │ Energy    │    │
                   │  │ Reserv.   │  │ Wallet    │  │ Dispatch  │    │
                   │  │ Service   │  │ Service   │  │ Service   │    │
                   │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘    │
                   └────────┼──────────────┼──────────────┼──────────┘
                            │              │              │
                            │ (VPC Private Subnet)        │
                            ▼              ▼              ▼
                   ┌─────────────────────────────────────────────────┐
                   │             DYNAMODB DATABASES                  │
                   │  ┌────────────┐ ┌───────────┐  ┌───────────┐    │
                   │  │Reservations│ │ Billing   │  │ Dispatch  │    │
                   │  │Table       │ │Table      │  │Table      │    │
                   │  └────────────┘ └───────────┘  └───────────┘    │
                   └─────────────────────────────────────────────────┘
```

### 2.1 Capa de Presentación (Frontend)

**Tecnología Libre:** El estudiante puede elegir cualquier framework o librería moderna (React, Next.js, Vue, Angular, Svelte, etc.).

**Funcionalidades Mínimas en UI:**

- Panel de estado de electrolineras y disponibilidad de conectores en tiempo real.
- Flujo de reserva y activación de carga (disparador de la transacción distribuida SAGA).
- Visualizador de estado de Feature Flags activas según el ambiente (`dev`, `test`, `prod`).
- Panel de historial de transacciones y estado de compensaciones en caso de fallos.

### 2.2 Capa de Backend, API y Orquestación de Contenedores

**API Gateway & GraphQL:** El punto de entrada hacia la lógica de negocio debe exponer un esquema unificado en GraphQL (*Queries* para consultar estaciones/telemetría y *Mutations* para iniciar reservas, pagos y sesiones de carga).

**Arquitectura de Microservicios:** Mínimo tres (3) microservicios desacoplados empaquetados en contenedores Docker y desplegados sobre un clúster de Kubernetes:

- `station-reservation-service`: Gestión de disponibilidad y bloqueo temporal de bahías de carga.
- `billing-wallet-service`: Verificación de fondos, cobro y reembolso a la billetera de la flota.
- `energy-dispatch-service`: Orden de activación física del cargador y registro de telemetría.

**Feature Flags por Ambiente Estático:** Implementación de un sistema de Feature Flags (propio en DynamoDB, Unleash, Flagsmith o AWS AppConfig) donde cada ambiente (`dev`, `test`, `prod`) posea su propio estado independiente. Ejemplos de flags requeridas:

| Flag | Propósito |
|---|---|
| `ENABLE_DYNAMIC_SURGE_PRICING` | Activa tarifas dinámicas en horas pico (ej. `true` en dev y test, `false` en prod). |
| `ENABLE_FAST_CHARGE_BOOST` | Habilita reserva prioritaria de ultra-carga. |
| `SIMULATE_CHARGER_HARDWARE_FAULT` | Flag de inyección de fallos para demostrar en vivo el rollback de la SAGA. |

### 2.3 Patrón SAGA y Transacciones Compensatorias

El flujo principal de negocio (**"Reservar y Activar Carga"**) atraviesa los tres microservicios y no puede utilizar transacciones ACID monolíticas. Debe implementarse el patrón SAGA (por Orquestación o Coreografía):

1. **Paso 1 (Reserva):** `station-reservation-service` cambia el estado del conector a `RESERVED` en su tabla DynamoDB.
2. **Paso 2 (Cobro):** `billing-wallet-service` descuenta el saldo estimado de la cuenta de la flota en su tabla DynamoDB.
3. **Paso 3 (Activación Física):** `energy-dispatch-service` intenta iniciar el flujo eléctrico en el cargador.

**Flujo de Compensación (Rollback Distribuido):**

- **Si el Paso 3 falla** (por ejemplo, el cargador reporta error físico o está activada la flag `SIMULATE_CHARGER_HARDWARE_FAULT`), se debe disparar automáticamente la transacción compensatoria en `billing-wallet-service` (reembolsando el saldo y registrando el evento de reversión) y posteriormente en `station-reservation-service` (liberando el conector a estado `AVAILABLE`).
- **Si el Paso 2 falla** (fondos insuficientes), se ejecuta la compensación en `station-reservation-service` liberando el conector inmediatamente.

### 2.4 Infraestructura como Código (IaC), Networking y Persistencia

**Terraform + AWS (con opción de usar Floci / emulación local de nube):** Toda la infraestructura debe estar declarada en módulos de Terraform sin creación manual por consola. Se permite el uso de AWS real o entornos compatibles como Floci.

**Gestión de Estados en S3 y Backups:**

- Todos los `terraform.tfstate` del proyecto deben almacenarse de forma remota en un bucket de Amazon S3 con **Versionamiento Habilitado (Versioning Enabled)** para garantizar el acceso a backups históricos de cualquier estado en caso de corrupción o auditoría.

**Aislamiento con Terraform Workspaces:**

- Cada ambiente (`dev`, `test`, `prod`) debe corresponder obligatoriamente a un Workspace diferente de Terraform (`terraform workspace select dev|test|prod`).
- Los recursos deben parametrizarse usando `${terraform.workspace}` para evitar colisiones de nombres y garantizar separación lógica y de estado en S3 (`env:/dev/...`, `env:/test/...`, `env:/prod/...`).

**VPC, Subredes y VPC Endpoints (VPCE):**

- Creación de una VPC dedicada con subredes privadas y públicas por ambiente.
- Configuración de VPC Endpoints (VPCE) dentro de la VPC que conecten de forma privada hacia los endpoints de API Gateway (APIGW) y hacia los servicios en el clúster de Kubernetes, evitando que el tráfico interno salga a la internet pública. Adicionalmente, configurar Gateway/Interface VPCE para S3, DynamoDB y CloudWatch.

**Base de Datos NoSQL (Amazon DynamoDB):**

- Uso exclusivo de DynamoDB aprovisionado vía Terraform (con o sin Floci), aplicando el patrón **Database-per-Service** y separado por ambiente (ej. `aegisvolt-reservations-dev`, `aegisvolt-billing-test`, `aegisvolt-dispatch-prod`).

### 2.5 Observabilidad y Orquestación de Flujos

- **Amazon CloudWatch:** Centralización de logs estructurados (formato JSON con `correlation_id` de cada SAGA, ambiente y microservicio) en grupos de logs de CloudWatch diferenciados por ambiente (`/aegisvolt/dev/...`, `/aegisvolt/test/...`, `/aegisvolt/prod/...`).
- **Prefect para Observabilidad del Curso:** Implementación de flujos (*Flows* y *Tasks*) en Prefect que monitoreen la salud de los tres ambientes, auditen la consistencia de las transacciones SAGA en DynamoDB (detectando transacciones huérfanas o compensadas) y reporten métricas de observabilidad en el dashboard de Prefect.

---

## 3. Gobernanza de Git, Estrategia de Promoción y CI/CD

### 3.1 Reglas de Ramas y Protección (GitHub / GitLab)

El repositorio debe contar con tres ramas principales correspondientes a los ambientes estáticos: `dev` (o `develop`), `test` y `prod`.

**Reglas obligatorias de protección de ramas (`dev`, `test`, `prod`):**

- **Prohibido el Force Push** (`git push --force`) bajo cualquier circunstancia.
- **Prohibido el Push directo** a `dev`, `test` y `prod`. Todo cambio debe ingresar exclusivamente mediante un Pull Request (PR) / Merge Request (MR).
- **Checks de CI obligatorios en verde** (Unit Tests, Integration Tests, E2E Tests y `terraform plan`) antes de habilitar el botón de Merge.

### 3.2 Flujo Estricto de Promoción entre Ambientes (Promote Strategy)

```
[ Rama feature/* ] ────────► (MR / PR) ────────► [ Rama dev ] ─── (Deploy a Dev)
                                                     │
                                                 (MR / PR)
                                                     │
                                                     ▼
                                               [ Rama test ] ─── (Deploy a Test)
                                                     │
                                                 (MR / PR)
                                                     │
                                                     ▼
                                               [ Rama prod ] ─── (Deploy a Prod)
```

Para evitar conflictos de historial en Git (merge conflicts cruzados o cherry-picks desordenados), **nunca** se debe crear ni empujar una rama de funcionalidad directamente hacia `test` o `prod`. El flujo de promoción debe seguir estrictamente esta cadena lineal vía MR/PR:

1. **`feature/*` -> `dev`:** El desarrollador crea su rama desde `dev` y abre un MR/PR con origen `feature/nueva-funcionalidad` y destino `dev`.
2. **Promote `dev` -> `test`:** Una vez validado en el ambiente dev, se abre un nuevo MR/PR cuyo origen es `dev` y destino es `test`.
3. **Promote `test` -> `prod`:** Una vez superadas las pruebas en test, se abre un nuevo MR/PR cuyo origen es `test` y destino es `prod`.

### 3.3 Pipeline de CI/CD Automatizado

**En eventos de Pull Request / Merge Request (Pre-Merge):**

- `lint & build`: Compilación y validación de imágenes Docker y esquemas GraphQL.
- `unit-tests`: Pruebas unitarias de lógica de negocio y compensaciones SAGA.
- `integration-tests`: Pruebas de integración contra tablas DynamoDB y endpoints GraphQL.
- `e2e-tests`: Pruebas de extremo a extremo validando el flujo completo desde el Frontend/API.
- `terraform-plan`: Selecciona el Workspace de Terraform correspondiente a la rama destino (`dev`, `test` o `prod`) y ejecuta `terraform plan`, adjuntando o validando el plan antes de autorizar el merge.

**En eventos de Merge a Rama Destino (Post-Merge):**

- **Detección dinámica de Target Branch:** El pipeline identifica a qué rama se hizo merge (`dev`, `test` o `prod`), selecciona automáticamente el Workspace de Terraform (`terraform workspace select <ambiente>`) y ejecuta `terraform apply -auto-approve` modificando únicamente el ambiente correspondiente.
- **Estrategia de Canary Deployment:** En el despliegue hacia Kubernetes, el pipeline no reemplaza el 100% de los pods de golpe. Debe desplegar una versión Canary (ej. 10% - 20% del tráfico hacia la nueva versión del microservicio mientras el 80% - 90% permanece en la versión estable), ejecutar verificaciones de salud (health checks / métricas de error en CloudWatch) y, solo si el umbral de éxito se cumple, promover el despliegue al 100% de las réplicas (o hacer rollback automático si falla).

---

## 5. Metodología de Evaluación y Rúbrica Oficial

### 5.1 Reglas de Calificación (Sustentación Individual por Preguntas)

- La entrega es **100% individual**.
- La evaluación se realizará mediante una sesión de sustentación en vivo donde el profesor formulará preguntas conceptuales, arquitectónicas y prácticas sobre el código, la infraestructura y los pipelines del estudiante, además de solicitar demostraciones en caliente (ej. forzar un fallo en la SAGA o inspeccionar un estado en S3).
- Cada pregunta se califica de forma binaria: **Correcta** (100% del valor de la pregunta) o **Incorrecta** (0% del valor de la pregunta). El puntaje de cada capa se calcula según la proporción de respuestas correctas dentro de esa categoría multiplicada por el peso porcentual de la capa.

### 5.2 Distribución de Pesos por Capa Arquitectónica

| Capa / Categoría Evaluada | Peso (%) | Enfoque de Evaluación y Criterios Clave |
|---|---|---|
| **1. Infraestructura como Código** (Terraform, Workspaces, S3 Backups, VPC/VPCE y DynamoDB) | **30%** | Uso real de Workspaces (`dev`, `test`, `prod`), versionamiento e historial de tfstate en S3, arquitectura de red privada con VPC y VPCE hacia API Gateway/Kubernetes, y aprovisionamiento de tablas DynamoDB (con o sin Floci). |
| **2. CI/CD, Gobernanza de Git, Ambientes Estáticos y Canary Deployment** | **25%** | Reglas de protección de ramas (bloqueo de force push y push directo), flujo de promoción por MR (feature -> dev -> test -> prod), ejecución de tests (unit, integration, e2e) y `terraform plan` en MR, `terraform apply` dinámico según rama destino y estrategia Canary en Kubernetes. |
| **3. Arquitectura Backend, Microservicios, Kubernetes, GraphQL, SAGA y Feature Flags** | **25%** | Diseño del esquema GraphQL, desacople de microservicios en Docker/Kubernetes, ejecución demostrable de transacciones compensatorias (SAGA) ante fallos inducidos y aislamiento del estado de Feature Flags por cada ambiente estático. |
| **4. Observabilidad** (CloudWatch + Prefect) | **12%** | Trazabilidad de logs en CloudWatch por ambiente y `correlation_id`, junto con flujos funcionales en Prefect que supervisen el estado de la arquitectura y las transacciones SAGA. |
| **5. Capa de Presentación** (Frontend Web) | **8%** | Interfaz funcional conectada al endpoint GraphQL en cada ambiente, reflejando en tiempo real el comportamiento de las Feature Flags y el estado de las reservas/compensaciones. |
| **TOTAL** | **100%** | Nota final calculada sobre respuestas correctas / incorrectas en la defensa. |

---

## 6. Banco de Preguntas Guía para la Sustentación

Durante la defensa oral, se formularán preguntas técnicas directas y demostraciones prácticas. A continuación se presentan los ejes de verificación por capa:

### 6.1 Infraestructura como Código, S3 y Redes (30%)

- ¿Cómo garantiza su código de Terraform que al ejecutar `terraform apply` en la rama `test` no se sobrescriban las tablas de DynamoDB ni el estado del ambiente `prod` en S3?
- Muestre en su bucket S3 las versiones anteriores del archivo `terraform.tfstate` del workspace `dev` y explique cómo restauraría la versión previa ante un cambio corrupto.
- Explique el recorrido de un paquete de red desde el API Gateway hasta el pod en Kubernetes a través del VPC Endpoint (VPCE) y qué tabla de enrutamiento o política de seguridad interviene.

### 6.2 CI/CD, Promoción de Ambientes y Canary Deployments (25%)

- Intente hacer un `git push --force` o un push directo a la rama `test` desde su terminal y muestre qué regla del repositorio lo bloquea.
- Explique en el archivo YAML de su pipeline cómo se determina dinámicamente sobre qué ambiente correr `terraform apply` tras fusionar un Merge Request.
- ¿Qué métrica o condición evalúa su etapa de Canary Deployment antes de promover el tráfico del 20% al 100% en Kubernetes?

### 6.3 Patrones Arquitectónicos, SAGA y Feature Flags (25%)

- Active la Feature Flag de fallo en el ambiente `test`, dispare una mutación GraphQL de reserva de carga y demuestre en las tablas de DynamoDB cómo se ejecutó la transacción compensatoria en el servicio de facturación y reservas.
- ¿Cómo evita su implementación de SAGA problemas de falta de idempotencia si un mensaje o petición de compensación se procesa dos veces?

### 6.4 Observabilidad y Capa de Presentación (20%)

- Muestre en Prefect la ejecución del flujo de observabilidad y rastree en CloudWatch el `correlation_id` de una transacción SAGA fallida.
- Cambie el estado de una Feature Flag en `dev` sin redesplegar el código y muestre cómo cambia el comportamiento en el Frontend web de `dev` mientras `prod` permanece intacto.
