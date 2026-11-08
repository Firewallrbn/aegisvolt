// station-reservation-service: disponibilidad y bloqueo temporal de conectores (paso 1 de la SAGA).
import { ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, flag, getItem, HttpError, idempotent, log, now, serve, table } from '../common/index.ts';

const T = table('reservations');
const connectorKey = (stationId: string, connectorId: string) => ({
  pk: `STATION#${stationId}`,
  sk: `CONNECTOR#${connectorId}`,
});

serve(Number(process.env.PORT ?? 4001), {
  'GET /stations': async () => {
    const { Items = [] } = await ddb.send(new ScanCommand({
      TableName: T,
      FilterExpression: 'begins_with(pk, :p)',
      ExpressionAttributeValues: { ':p': 'STATION#' },
    }));
    return Items.map((i) => ({
      stationId: String(i.pk).slice('STATION#'.length),
      connectorId: String(i.sk).slice('CONNECTOR#'.length),
      status: i.status,
      powerKw: i.powerKw,
      ultra: i.ultra === true,
      sagaId: i.sagaId,
    }));
  },

  // Paso 1: AVAILABLE -> RESERVED, atado al sagaId
  'POST /reservations': async ({ sagaId, stationId, connectorId }) => {
    const key = connectorKey(stationId, connectorId);
    const connector = await getItem(T, key);
    if (!connector) throw new HttpError(404, `conector ${stationId}/${connectorId} no existe`);
    if (connector.ultra && !(await flag('ENABLE_FAST_CHARGE_BOOST'))) {
      throw new HttpError(403, 'ultra-carga deshabilitada (ENABLE_FAST_CHARGE_BOOST)');
    }

    const marker = { pk: `SAGA#${sagaId}`, sk: 'RESERVE' };
    const r = await idempotent(T, marker, () => ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: T,
            Key: key,
            UpdateExpression: 'SET #s = :reserved, sagaId = :id',
            ConditionExpression: '#s = :available',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':reserved': 'RESERVED', ':available': 'AVAILABLE', ':id': sagaId },
          },
        },
        { Put: { TableName: T, Item: { ...marker, stationId, connectorId, at: now() }, ConditionExpression: 'attribute_not_exists(pk)' } },
      ],
    })), new HttpError(409, `conector ${stationId}/${connectorId} no disponible`));

    log('info', r.duplicate ? 'reserva duplicada ignorada' : 'conector reservado', { correlation_id: sagaId, stationId, connectorId });
    return { status: 'RESERVED', powerKw: connector.powerKw };
  },

  // Compensación del paso 1 (y fin normal de carga): RESERVED -> AVAILABLE, solo si sigue siendo de esta SAGA
  'POST /reservations/:sagaId/release': async (_body, { sagaId }) => {
    const reserve = await getItem(T, { pk: `SAGA#${sagaId}`, sk: 'RESERVE' });
    if (!reserve) return { status: 'NOTHING_TO_RELEASE' };

    const marker = { pk: `SAGA#${sagaId}`, sk: 'RELEASE' };
    const r = await idempotent(T, marker, () => ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: T,
            Key: connectorKey(reserve.stationId, reserve.connectorId),
            UpdateExpression: 'SET #s = :available REMOVE sagaId',
            ConditionExpression: 'sagaId = :id',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':available': 'AVAILABLE', ':id': sagaId },
          },
        },
        { Put: { TableName: T, Item: { ...marker, at: now() }, ConditionExpression: 'attribute_not_exists(pk)' } },
      ],
    })), new HttpError(409, 'el conector ya no pertenece a esta SAGA'));

    log('info', r.duplicate ? 'liberación duplicada ignorada' : 'conector liberado', { correlation_id: sagaId });
    return { status: 'AVAILABLE' };
  },
});
