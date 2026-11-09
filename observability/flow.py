"""Flujo de observabilidad de AegisVolt en Prefect.

Por cada ambiente (dev, test, prod):
  1. Salud: GET /health a través de API Gateway (el mismo camino que usa el frontend).
  2. Auditoría SAGA en DynamoDB: estados, huérfanas (RUNNING estancadas), COMPENSATION_FAILED,
     conectores reservados por SAGAs que ya no están activas y cobros compensados sin reembolso.
  3. Errores en CloudWatch: logs level=error de la última hora en /aegisvolt/<env>/*.
Publica una tabla y un resumen como artifacts en el dashboard de Prefect. El flow termina en Failed
si encuentra inconsistencias SAGA (un ambiente caído se reporta, pero no hace fallar la auditoría).

Uso:  python flow.py          -> una ejecución
      python flow.py --serve  -> deployment programado cada 5 minutos
"""
import os
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

import boto3
import requests
from prefect import flow, get_run_logger, task
from prefect.artifacts import create_markdown_artifact, create_table_artifact

for k, v in {"AWS_ENDPOINT_URL": "http://localhost:4566", "AWS_ACCESS_KEY_ID": "test",
             "AWS_SECRET_ACCESS_KEY": "test", "AWS_DEFAULT_REGION": "us-east-1"}.items():
    os.environ.setdefault(k, v)
ENDPOINT = os.environ["AWS_ENDPOINT_URL"]
ENVS = ["dev", "test", "prod"]
STUCK_AFTER = timedelta(minutes=2)  # una SAGA tarda < 1 s; RUNNING más de esto = el gateway murió a mitad
ACTIVE = {"RUNNING", "COMPLETED"}  # estados en los que una SAGA puede tener un conector reservado

ddb = boto3.resource("dynamodb")
logs = boto3.client("logs")
apigw = boto3.client("apigatewayv2")


def scan(table: str) -> list[dict]:
    t, items, kw = ddb.Table(table), [], {}
    while True:
        page = t.scan(**kw)
        items += page["Items"]
        if "LastEvaluatedKey" not in page:
            return items
        kw["ExclusiveStartKey"] = page["LastEvaluatedKey"]


@task(retries=1, retry_delay_seconds=2)
def check_health(env: str) -> dict:
    api = next((a for a in apigw.get_apis()["Items"] if a["Name"] == f"aegisvolt-{env}"), None)
    if not api:
        return {"up": False, "latency_ms": None, "detail": "sin API Gateway"}
    start = time.perf_counter()
    try:
        r = requests.get(f"{ENDPOINT}/execute-api/{api['ApiId']}/$default/health", timeout=5)
        up, detail = r.ok, f"HTTP {r.status_code}"
    except requests.RequestException as e:
        up, detail = False, type(e).__name__
    return {"up": up, "latency_ms": round((time.perf_counter() - start) * 1000), "detail": detail}


def find_inconsistencies(sagas: list[dict], connectors: list[dict], billing_markers: set[tuple[str, str]],
                         now: datetime) -> list[str]:
    """Reglas de consistencia SAGA (función pura: se prueba en test_flow.py)."""
    by_id = {s["id"]: s for s in sagas}
    found = []
    for s in sagas:
        if s["status"] == "RUNNING" and now - datetime.fromisoformat(s["createdAt"]) > STUCK_AFTER:
            found.append(f"SAGA huérfana {s['id']}: RUNNING desde {s['createdAt']}")
        if s["status"] == "COMPENSATION_FAILED":
            found.append(f"SAGA {s['id']} en COMPENSATION_FAILED: requiere intervención manual")
        if s["status"] in {"COMPENSATED", "COMPENSATION_FAILED"} and (s["id"], "CHARGE") in billing_markers \
                and (s["id"], "REFUND") not in billing_markers:
            found.append(f"SAGA {s['id']} compensada con cobro sin reembolso")
    for c in connectors:
        if c.get("status") == "RESERVED" and by_id.get(c.get("sagaId"), {}).get("status") not in ACTIVE:
            found.append(f"conector {c['pk'][8:]}/{c['sk'][10:]} reservado por SAGA no activa {c.get('sagaId')}")
    return found


@task
def audit_sagas(env: str) -> dict:
    sagas = scan(f"aegisvolt-sagas-{env}")
    reservations = scan(f"aegisvolt-reservations-{env}")
    billing = scan(f"aegisvolt-billing-{env}")
    connectors = [i for i in reservations if i["pk"].startswith("STATION#")]
    markers = {(i["pk"][5:], i["sk"]) for i in billing if i["pk"].startswith("SAGA#")}
    issues = find_inconsistencies(sagas, connectors, markers, datetime.now(timezone.utc))
    return {"total": len(sagas), "by_status": dict(Counter(s["status"] for s in sagas)), "issues": issues}


@task
def count_errors(env: str) -> int:
    since = int((time.time() - 3600) * 1000)
    groups = logs.describe_log_groups(logGroupNamePrefix=f"/aegisvolt/{env}/")["logGroups"]
    return sum(len(logs.filter_log_events(logGroupName=g["logGroupName"], startTime=since,
                                          filterPattern='"\\"level\\":\\"error\\""')["events"]) for g in groups)


@flow(name="aegisvolt-observabilidad", log_prints=True)
def observability(envs: list[str] = ENVS) -> list[dict]:
    logger = get_run_logger()
    rows, issues = [], []
    for env in envs:
        health, audit, errors = check_health.submit(env), audit_sagas.submit(env), count_errors.submit(env)
        h, a, e = health.result(), audit.result(), errors.result()
        rows.append({
            "ambiente": env,
            "salud": "UP" if h["up"] else f"DOWN ({h['detail']})",
            "latencia_ms": h["latency_ms"],
            "sagas": a["total"],
            **{k.lower(): a["by_status"].get(k, 0) for k in
               ["COMPLETED", "FINISHED", "COMPENSATED", "COMPENSATION_FAILED", "RUNNING"]},
            "inconsistencias": len(a["issues"]),
            "errores_1h": e,
        })
        issues += [f"[{env}] {i}" for i in a["issues"]]
        logger.info("%s: %s, %d sagas, %d inconsistencias, %d errores/h", env, rows[-1]["salud"], a["total"],
                    len(a["issues"]), e)

    create_table_artifact(key="aegisvolt-salud", table=rows, description="Salud, SAGAs y errores por ambiente")
    create_markdown_artifact(key="aegisvolt-inconsistencias", markdown="## Inconsistencias SAGA\n" + (
        "\n".join(f"- {i}" for i in issues) if issues else "Ninguna: todas las SAGAs están completas o compensadas."))
    if issues:
        raise RuntimeError(f"{len(issues)} inconsistencias SAGA: " + "; ".join(issues))
    return rows


if __name__ == "__main__":
    if "--serve" in sys.argv:
        observability.serve(name="cada-5-min", interval=300)
    else:
        observability()
