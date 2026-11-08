// E2E de la SAGA contra los servicios corriendo (local o en el clúster). Uso: npm run e2e
// GATEWAY_URL apunta al gateway; BILLING_URL se usa solo para probar idempotencia del reembolso.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000/graphql';
const BILLING = process.env.BILLING_URL ?? 'http://localhost:4002';

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(GATEWAY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const body: any = await res.json();
  if (body.errors) throw new Error(body.errors.map((e: any) => e.message).join('; '));
  return body.data;
}

const SAGA = `id status amount error steps { step status error }`;
const reserve = (fleetId: string, connectorId = 'c1') =>
  gql(`mutation($f: ID!, $c: ID!) { reserveAndCharge(stationId: "st-sur", connectorId: $c, fleetId: $f, kwh: 10) { ${SAGA} } }`, { f: fleetId, c: connectorId })
    .then((d) => d.reserveAndCharge);
const balance = (fleetId: string) => gql(`query($f: ID!) { wallet(fleetId: $f) { balance } }`, { f: fleetId }).then((d) => d.wallet.balance);
const connectorStatus = async (connectorId: string) => {
  const { stations } = await gql('{ stations { id connectors { id status } } }');
  return stations.find((s: any) => s.id === 'st-sur').connectors.find((c: any) => c.id === connectorId).status;
};
const setFault = (enabled: boolean) =>
  gql('mutation($e: Boolean!) { setFlag(name: "SIMULATE_CHARGER_HARDWARE_FAULT", enabled: $e) { enabled } }', { e: enabled });
const steps = (saga: any) => saga.steps.map((s: any) => `${s.step}:${s.status}`);

after(() => setFault(false)); // nunca dejar la falla activada

test('camino feliz: COMPLETED, cobra y reserva; finishCharge libera el conector', async () => {
  await setFault(false);
  const before = await balance('fleet-andina');
  const saga = await reserve('fleet-andina');
  assert.equal(saga.status, 'COMPLETED', saga.error);
  assert.deepEqual(steps(saga), ['RESERVE:DONE', 'CHARGE:DONE', 'ACTIVATE:DONE']);
  assert.equal(await balance('fleet-andina'), Math.round((before - saga.amount) * 100) / 100);
  assert.equal(await connectorStatus('c1'), 'RESERVED');

  const done = await gql(`mutation($id: ID!) { finishCharge(sagaId: $id) { status } }`, { id: saga.id });
  assert.equal(done.finishCharge.status, 'FINISHED');
  assert.equal(await connectorStatus('c1'), 'AVAILABLE');
});

test('falla el paso 2 (sin fondos): se libera el conector y no se cobra', async () => {
  const before = await balance('fleet-sin-saldo');
  const saga = await reserve('fleet-sin-saldo');
  assert.equal(saga.status, 'COMPENSATED');
  assert.deepEqual(steps(saga), ['RESERVE:DONE', 'CHARGE:FAILED', 'RESERVE:COMPENSATED']);
  assert.equal(await balance('fleet-sin-saldo'), before);
  assert.equal(await connectorStatus('c1'), 'AVAILABLE');
});

test('falla el paso 3 (flag de falla física): reembolso y luego liberación', async () => {
  await setFault(true);
  const before = await balance('fleet-andina');
  const saga = await reserve('fleet-andina');
  assert.equal(saga.status, 'COMPENSATED');
  assert.deepEqual(steps(saga), ['RESERVE:DONE', 'CHARGE:DONE', 'ACTIVATE:FAILED', 'CHARGE:COMPENSATED', 'RESERVE:COMPENSATED']);
  assert.equal(await balance('fleet-andina'), before);
  assert.equal(await connectorStatus('c1'), 'AVAILABLE');

  // Idempotencia: repetir el reembolso no devuelve el dinero dos veces
  const res = await fetch(`${BILLING}/charges/${saga.id}/refund`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(await balance('fleet-andina'), before);
  await setFault(false);
});
