// graphql-gateway: esquema GraphQL unificado y orquestador de la SAGA "Reservar y Activar Carga".
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildSchema, graphql } from 'graphql';
import { PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { call, ddb, ENV, getItem, HttpError, log, now, serve, table } from '../common/index.ts';
import { runSaga, type SagaEvent } from './saga.ts';

const URLS = {
  reservation: process.env.RESERVATION_URL ?? 'http://localhost:4001',
  billing: process.env.BILLING_URL ?? 'http://localhost:4002',
  dispatch: process.env.DISPATCH_URL ?? 'http://localhost:4003',
};
const SAGAS = table('sagas');
const FLAGS = table('flags');

const schema = buildSchema(readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8'));

const updateSaga = (id: string, fields: Record<string, unknown>) => {
  // Sin undefined: el SDK los descarta y la expresión quedaría apuntando a un :v inexistente
  const entries = Object.entries({ ...fields, updatedAt: now() }).filter(([, v]) => v !== undefined);
  return ddb.send(new UpdateCommand({
    TableName: SAGAS,
    Key: { id },
    UpdateExpression: 'SET ' + entries.map((_, i) => `#k${i} = :v${i}`).join(', '),
    ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
    ExpressionAttributeValues: Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
  }));
};

const appendStep = (id: string, e: SagaEvent) => ddb.send(new UpdateCommand({
  TableName: SAGAS,
  Key: { id },
  UpdateExpression: 'SET steps = list_append(steps, :e), updatedAt = :t',
  ExpressionAttributeValues: { ':e': [{ ...e, at: now() }], ':t': now() },
}));

const root = {
  env: () => ENV,

  stations: async () => {
    const connectors: any[] = await call(URLS.reservation, 'GET', '/stations', undefined, 'query');
    const byStation = Map.groupBy(connectors, (c) => c.stationId);
    return [...byStation].sort(([a], [b]) => a.localeCompare(b)).map(([id, cs]) => ({
      id,
      connectors: cs.map((c: any) => ({ ...c, id: c.connectorId })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    }));
  },

  flags: async () => (await ddb.send(new ScanCommand({ TableName: FLAGS }))).Items ?? [],

  setFlag: async ({ name, enabled }: { name: string; enabled: boolean }) => {
    if (!(await getItem(FLAGS, { name }))) throw new HttpError(404, `flag ${name} no existe`);
    await ddb.send(new PutCommand({ TableName: FLAGS, Item: { name, enabled } }));
    log('info', 'feature flag cambiada', { flag: name, enabled });
    return { name, enabled };
  },

  wallet: ({ fleetId }: { fleetId: string }) =>
    call(URLS.billing, 'GET', `/wallets/${encodeURIComponent(fleetId)}`, undefined, 'query'),

  sagas: async () => {
    const items = (await ddb.send(new ScanCommand({ TableName: SAGAS }))).Items ?? [];
    return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },

  saga: ({ id }: { id: string }) => getItem(SAGAS, { id }),

  telemetry: ({ sagaId }: { sagaId: string }) =>
    call(URLS.dispatch, 'GET', `/sessions/${encodeURIComponent(sagaId)}`, undefined, sagaId),

  reserveAndCharge: async (args: { stationId: string; connectorId: string; fleetId: string; kwh: number }) => {
    const id = randomUUID(); // también es el correlation_id de todos los logs de esta SAGA
    await ddb.send(new PutCommand({
      TableName: SAGAS,
      Item: { id, status: 'RUNNING', ...args, steps: [], createdAt: now() },
    }));
    log('info', 'SAGA iniciada', { correlation_id: id, ...args });

    const body = { sagaId: id, ...args };
    let powerKw = 0;
    let amount: number | undefined;
    const result = await runSaga([
      {
        name: 'RESERVE',
        run: async () => { powerKw = (await call(URLS.reservation, 'POST', '/reservations', body, id)).powerKw; },
        compensate: () => call(URLS.reservation, 'POST', `/reservations/${id}/release`, {}, id),
      },
      {
        name: 'CHARGE',
        run: async () => { amount = (await call(URLS.billing, 'POST', '/charges', body, id)).amount; },
        compensate: () => call(URLS.billing, 'POST', `/charges/${id}/refund`, {}, id),
      },
      {
        name: 'ACTIVATE',
        run: () => call(URLS.dispatch, 'POST', '/sessions', { ...body, powerKw }, id),
      },
    ], async (e) => void (await appendStep(id, e)));

    await updateSaga(id, { status: result.status, amount, error: result.error });
    log(result.status === 'COMPLETED' ? 'info' : 'warn', `SAGA ${result.status}`, { correlation_id: id, error: result.error });
    return getItem(SAGAS, { id });
  },

  finishCharge: async ({ sagaId }: { sagaId: string }) => {
    const saga = await getItem(SAGAS, { id: sagaId });
    if (!saga) throw new HttpError(404, 'SAGA no existe');
    if (saga.status !== 'COMPLETED') throw new HttpError(409, `la SAGA está en ${saga.status}, no en COMPLETED`);
    await call(URLS.dispatch, 'POST', `/sessions/${sagaId}/stop`, {}, sagaId);
    await call(URLS.reservation, 'POST', `/reservations/${sagaId}/release`, {}, sagaId);
    await updateSaga(sagaId, { status: 'FINISHED' });
    log('info', 'carga finalizada', { correlation_id: sagaId });
    return getItem(SAGAS, { id: sagaId });
  },
};

serve(Number(process.env.PORT ?? 4000), {
  'POST /graphql': async ({ query, variables }) => {
    if (typeof query !== 'string') throw new HttpError(400, 'falta "query"');
    return graphql({ schema, source: query, rootValue: root, variableValues: variables });
  },
});
