// energy-dispatch-service: activación física del cargador y telemetría (paso 3 de la SAGA).
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, flag, getItem, HttpError, idempotent, log, now, serve, table } from '../common/index.ts';

const T = table('dispatch');
const sessionKey = (sagaId: string) => ({ pk: `SAGA#${sagaId}`, sk: 'SESSION' });

// Telemetría simulada: energía entregada = potencia x tiempo transcurrido
function telemetry(s: Record<string, any>) {
  const end = s.stoppedAt ? Date.parse(s.stoppedAt) : Date.now();
  const hours = s.status === 'FAULT' ? 0 : (end - Date.parse(s.startedAt)) / 3_600_000;
  return { ...s, sagaId: String(s.pk).slice('SAGA#'.length), kwhDelivered: Math.round(s.powerKw * hours * 1000) / 1000 };
}

serve(Number(process.env.PORT ?? 4003), {
  // Paso 3: el cargador arranca, o reporta falla física (real o simulada por flag)
  'POST /sessions': async ({ sagaId, stationId, connectorId, powerKw }) => {
    const fault = await flag('SIMULATE_CHARGER_HARDWARE_FAULT');
    const session = {
      ...sessionKey(sagaId), stationId, connectorId, powerKw: Number(powerKw) || 0,
      status: fault ? 'FAULT' : 'CHARGING', startedAt: now(),
    };
    const r = await idempotent(T, sessionKey(sagaId), () => ddb.send(new PutCommand({
      TableName: T, Item: session, ConditionExpression: 'attribute_not_exists(pk)',
    })), new HttpError(409, 'sesión en conflicto'));

    const s = r.item ?? session;
    if (s.status === 'FAULT') {
      log('error', 'falla física del cargador', { correlation_id: sagaId, stationId, connectorId });
      throw new HttpError(502, `falla física del cargador ${stationId}/${connectorId}`);
    }
    log('info', 'carga activada', { correlation_id: sagaId, stationId, connectorId, powerKw: s.powerKw });
    return telemetry(s);
  },

  'GET /sessions/:sagaId': async (_body, { sagaId }) => {
    const s = await getItem(T, sessionKey(sagaId));
    if (!s) throw new HttpError(404, 'sesión no existe');
    return telemetry(s);
  },

  'POST /sessions/:sagaId/stop': async (_body, { sagaId }) => {
    try {
      await ddb.send(new UpdateCommand({
        TableName: T, Key: sessionKey(sagaId),
        UpdateExpression: 'SET #s = :stopped, stoppedAt = :t',
        ConditionExpression: '#s = :charging',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':stopped': 'STOPPED', ':charging': 'CHARGING', ':t': now() },
      }));
      log('info', 'carga detenida', { correlation_id: sagaId });
    } catch (e) {
      if ((e as Error).name !== 'ConditionalCheckFailedException') throw e; // ya detenida: idempotente
    }
    const s = await getItem(T, sessionKey(sagaId));
    if (!s) throw new HttpError(404, 'sesión no existe');
    return telemetry(s);
  },
});
