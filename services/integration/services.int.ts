// Integración: cada microservicio y el endpoint GraphQL contra tablas DynamoDB reales (ambiente "ci"). Uso: npm run integration
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const ENV = process.env.APP_ENV ?? 'ci';
const RESERVATION = process.env.RESERVATION_URL ?? 'http://localhost:14001';
const BILLING = process.env.BILLING_URL ?? 'http://localhost:14002';
const DISPATCH = process.env.DISPATCH_URL ?? 'http://localhost:14003';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:14000/graphql';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({
  endpoint: process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
}));
const item = async (t: string, key: Record<string, string>) =>
  (await ddb.send(new GetCommand({ TableName: `aegisvolt-${t}-${ENV}`, Key: key }))).Item;
const post = (url: string, body: unknown = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('reservation: reservar y liberar dos veces deja la tabla consistente (idempotencia)', async () => {
  const sagaId = randomUUID();
  const body = { sagaId, stationId: 'st-norte', connectorId: 'c1' };
  assert.equal((await post(`${RESERVATION}/reservations`, body)).status, 200);
  assert.equal((await post(`${RESERVATION}/reservations`, body)).status, 200); // duplicado
  const reserved = await item('reservations', { pk: 'STATION#st-norte', sk: 'CONNECTOR#c1' });
  assert.equal(reserved?.status, 'RESERVED');
  assert.equal(reserved?.sagaId, sagaId);

  await post(`${RESERVATION}/reservations/${sagaId}/release`);
  await post(`${RESERVATION}/reservations/${sagaId}/release`); // duplicado
  assert.equal((await item('reservations', { pk: 'STATION#st-norte', sk: 'CONNECTOR#c1' }))?.status, 'AVAILABLE');
});

test('reservation: otra SAGA no puede tomar un conector ya reservado (409)', async () => {
  const a = randomUUID();
  await post(`${RESERVATION}/reservations`, { sagaId: a, stationId: 'st-norte', connectorId: 'c1' });
  const res = await post(`${RESERVATION}/reservations`, { sagaId: randomUUID(), stationId: 'st-norte', connectorId: 'c1' });
  assert.equal(res.status, 409);
  await post(`${RESERVATION}/reservations/${a}/release`);
});

test('billing: un cobro repetido descuenta una sola vez; sin saldo responde 402', async () => {
  const before = (await item('billing', { pk: 'WALLET#fleet-andina', sk: 'BALANCE' }))?.balance;
  const sagaId = randomUUID();
  await post(`${BILLING}/charges`, { sagaId, fleetId: 'fleet-andina', kwh: 10 });
  await post(`${BILLING}/charges`, { sagaId, fleetId: 'fleet-andina', kwh: 10 }); // duplicado
  const after = (await item('billing', { pk: 'WALLET#fleet-andina', sk: 'BALANCE' }))?.balance;
  assert.equal(after, before - 12); // 10 kWh x 1.2 (surge apagado en ci)

  const poor = await post(`${BILLING}/charges`, { sagaId: randomUUID(), fleetId: 'fleet-sin-saldo', kwh: 10 });
  assert.equal(poor.status, 402);
  await post(`${BILLING}/charges/${sagaId}/refund`);
});

test('dispatch: lee la feature flag en caliente desde DynamoDB, sin reiniciar', async () => {
  const flags = `aegisvolt-flags-${ENV}`;
  await ddb.send(new PutCommand({ TableName: flags, Item: { name: 'SIMULATE_CHARGER_HARDWARE_FAULT', enabled: true } }));
  try {
    const res = await post(`${DISPATCH}/sessions`, { sagaId: randomUUID(), stationId: 'st-sur', connectorId: 'c2', powerKw: 50 });
    assert.equal(res.status, 502);
  } finally {
    await ddb.send(new PutCommand({ TableName: flags, Item: { name: 'SIMULATE_CHARGER_HARDWARE_FAULT', enabled: false } }));
  }
  const ok = await post(`${DISPATCH}/sessions`, { sagaId: randomUUID(), stationId: 'st-sur', connectorId: 'c2', powerKw: 50 });
  assert.equal(ok.status, 200);
});

test('graphql: el gateway resuelve estaciones, flags y saldo leyendo las tablas DynamoDB', async () => {
  const res = await post(GATEWAY, {
    query: '{ env stations { id connectors { id status powerKw } } flags { name enabled } wallet(fleetId: "fleet-andina") { balance } }',
  });
  assert.equal(res.status, 200);
  const { data, errors } = await res.json();
  assert.equal(errors, undefined);
  assert.equal(data.env, ENV);
  assert.deepEqual(data.stations.map((s: { id: string }) => s.id).sort(), ['st-norte', 'st-sur']);
  assert.equal(data.stations.flatMap((s: { connectors: unknown[] }) => s.connectors).length, 4);
  assert.equal(data.flags.length, 3);
  const balance = (await item('billing', { pk: 'WALLET#fleet-andina', sk: 'BALANCE' }))?.balance;
  assert.equal(data.wallet.balance, balance); // GraphQL refleja exactamente lo que hay en la tabla
});
