// Validación del esquema GraphQL (check "lint & build" del CI): debe compilar y exponer las operaciones de la UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSchema } from 'graphql';

const schema = buildSchema(readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8'));

test('el esquema compila y tiene las queries y mutations del contrato', () => {
  assert.deepEqual(
    Object.keys(schema.getQueryType()!.getFields()).sort(),
    ['env', 'flags', 'saga', 'sagas', 'stations', 'telemetry', 'wallet'],
  );
  assert.deepEqual(
    Object.keys(schema.getMutationType()!.getFields()).sort(),
    ['finishCharge', 'reserveAndCharge', 'setFlag'],
  );
});
