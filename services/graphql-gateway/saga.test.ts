import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../common/index.ts';
import { runSaga, type SagaEvent, type Step } from './saga.ts';

// Arma los 3 pasos de la SAGA real; `fail` decide qué paso falla y cómo. Registra el orden de llamadas.
function scenario(fail: Partial<Record<'RESERVE' | 'CHARGE' | 'ACTIVATE', Error>>) {
  const calls: string[] = [];
  const step = (name: 'RESERVE' | 'CHARGE' | 'ACTIVATE', compensable: boolean): Step => ({
    name,
    run: async () => {
      calls.push(name);
      if (fail[name]) throw fail[name];
    },
    compensate: compensable ? async () => void calls.push(`undo:${name}`) : undefined,
  });
  const events: SagaEvent[] = [];
  const run = () => runSaga(
    [step('RESERVE', true), step('CHARGE', true), step('ACTIVATE', false)],
    async (e) => void events.push(e),
  );
  return { calls, events, run };
}

test('camino feliz: los 3 pasos y ninguna compensación', async () => {
  const s = scenario({});
  assert.deepEqual(await s.run(), { status: 'COMPLETED' });
  assert.deepEqual(s.calls, ['RESERVE', 'CHARGE', 'ACTIVATE']);
});

test('falla el paso 2 (fondos insuficientes): solo se libera la reserva', async () => {
  const s = scenario({ CHARGE: new HttpError(402, 'fondos insuficientes') });
  const r = await s.run();
  assert.equal(r.status, 'COMPENSATED');
  assert.deepEqual(s.calls, ['RESERVE', 'CHARGE', 'undo:RESERVE']);
});

test('falla el paso 3 (cargador): reembolso y luego liberación, en ese orden', async () => {
  const s = scenario({ ACTIVATE: new HttpError(502, 'falla física') });
  const r = await s.run();
  assert.equal(r.status, 'COMPENSATED');
  assert.deepEqual(s.calls, ['RESERVE', 'CHARGE', 'ACTIVATE', 'undo:CHARGE', 'undo:RESERVE']);
});

test('timeout en el cobro (resultado incierto): también se compensa el cobro', async () => {
  const s = scenario({ CHARGE: new Error('timeout') });
  await s.run();
  assert.deepEqual(s.calls, ['RESERVE', 'CHARGE', 'undo:CHARGE', 'undo:RESERVE']);
});

test('compensación que falla siempre: la SAGA queda COMPENSATION_FAILED', async () => {
  const r = await runSaga(
    [
      { name: 'RESERVE', run: async () => {}, compensate: async () => { throw new Error('caído'); } },
      { name: 'CHARGE', run: async () => { throw new HttpError(402, 'sin fondos'); } },
    ],
    async () => {},
  );
  assert.equal(r.status, 'COMPENSATION_FAILED');
});
