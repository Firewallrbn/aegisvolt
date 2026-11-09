// Orquestador SAGA genérico: ejecuta pasos en orden y, si uno falla, compensa en orden inverso.
import { HttpError } from '../common/index.ts';

export type Step = { name: string; run: () => Promise<unknown>; compensate?: () => Promise<unknown> };
export type SagaEvent = { step: string; status: 'DONE' | 'FAILED' | 'COMPENSATED' | 'COMPENSATION_FAILED'; error?: string };
export type SagaResult = { status: 'COMPLETED' | 'COMPENSATED' | 'COMPENSATION_FAILED'; error?: string };

const COMPENSATION_ATTEMPTS = 3;

export async function runSaga(steps: Step[], record: (e: SagaEvent) => Promise<void>): Promise<SagaResult> {
  const toCompensate: Step[] = [];

  for (const step of steps) {
    try {
      await step.run();
      toCompensate.push(step);
      await record({ step: step.name, status: 'DONE' });
    } catch (e) {
      const error = (e as Error).message;
      await record({ step: step.name, status: 'FAILED', error });
      // Un 4xx es un rechazo seguro (no se aplicó). Con timeout o 5xx no se sabe: también se compensa ese paso,
      // lo cual es seguro porque las compensaciones son idempotentes y no hacen nada si no hubo efecto.
      const certainlyNotApplied = e instanceof HttpError && e.status < 500;
      if (!certainlyNotApplied) toCompensate.push(step);

      let status: SagaResult['status'] = 'COMPENSATED';
      for (const prev of toCompensate.reverse()) {
        if (!prev.compensate) continue;
        try {
          await retry(prev.compensate, COMPENSATION_ATTEMPTS);
          await record({ step: prev.name, status: 'COMPENSATED' });
        } catch (ce) {
          // Queda inconsistente: el flujo de Prefect la detecta como SAGA huérfana
          status = 'COMPENSATION_FAILED';
          await record({ step: prev.name, status: 'COMPENSATION_FAILED', error: (ce as Error).message });
        }
      }
      return { status, error };
    }
  }
  return { status: 'COMPLETED' };
}

async function retry(fn: () => Promise<unknown>, attempts: number): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await fn();
      return;
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 200 * i));
    }
  }
}
