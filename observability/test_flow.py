"""Self-check de las reglas de consistencia SAGA: python test_flow.py"""
from datetime import datetime, timedelta, timezone

from flow import find_inconsistencies

now = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
iso = lambda d: (now - d).isoformat()
sagas = [
    {"id": "ok", "status": "COMPLETED", "createdAt": iso(timedelta(hours=1))},
    {"id": "fresh", "status": "RUNNING", "createdAt": iso(timedelta(seconds=5))},
    {"id": "stuck", "status": "RUNNING", "createdAt": iso(timedelta(minutes=10))},
    {"id": "failed", "status": "COMPENSATION_FAILED", "createdAt": iso(timedelta(hours=1))},
    {"id": "refunded", "status": "COMPENSATED", "createdAt": iso(timedelta(hours=1))},
    {"id": "unrefunded", "status": "COMPENSATED", "createdAt": iso(timedelta(hours=1))},
]
connectors = [
    {"pk": "STATION#st-norte", "sk": "CONNECTOR#c1", "status": "RESERVED", "sagaId": "ok"},
    {"pk": "STATION#st-sur", "sk": "CONNECTOR#c1", "status": "RESERVED", "sagaId": "refunded"},
    {"pk": "STATION#st-sur", "sk": "CONNECTOR#c2", "status": "AVAILABLE"},
]
markers = {("refunded", "CHARGE"), ("refunded", "REFUND"), ("unrefunded", "CHARGE")}

issues = find_inconsistencies(sagas, connectors, markers, now)
assert len(issues) == 4, issues
for needle in ["huérfana stuck", "failed en COMPENSATION_FAILED", "unrefunded compensada",
               "st-sur/c1 reservado por SAGA no activa refunded"]:
    assert any(needle in i for i in issues), (needle, issues)
assert find_inconsistencies(sagas[:2], connectors[:1], set(), now) == []
print("ok: 4 inconsistencias detectadas, 0 falsos positivos")
