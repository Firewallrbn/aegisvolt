// billing-wallet-service: fondos, cobro y reembolso de la billetera de la flota (paso 2 de la SAGA).
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, flag, getItem, HttpError, idempotent, log, now, serve, table } from '../common/index.ts';

const T = table('billing');
const PRICE_PER_KWH = 1.2;
const SURGE_MULTIPLIER = 1.5;
const walletKey = (fleetId: string) => ({ pk: `WALLET#${fleetId}`, sk: 'BALANCE' });

serve(Number(process.env.PORT ?? 4002), {
  'GET /wallets/:fleetId': async (_body, { fleetId }) => {
    const wallet = await getItem(T, walletKey(fleetId));
    if (!wallet) throw new HttpError(404, `billetera ${fleetId} no existe`);
    return { fleetId, balance: wallet.balance };
  },

  // Paso 2: descuenta el estimado; la condición balance >= monto evita saldo negativo
  'POST /charges': async ({ sagaId, fleetId, kwh }) => {
    if (!(Number(kwh) > 0)) throw new HttpError(400, 'kwh debe ser mayor que 0');
    const surge = await flag('ENABLE_DYNAMIC_SURGE_PRICING');
    const amount = Math.round(Number(kwh) * PRICE_PER_KWH * (surge ? SURGE_MULTIPLIER : 1) * 100) / 100;

    const marker = { pk: `SAGA#${sagaId}`, sk: 'CHARGE' };
    const r = await idempotent(T, marker, () => ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: T,
            Key: walletKey(fleetId),
            UpdateExpression: 'SET balance = balance - :amount',
            ConditionExpression: 'attribute_exists(pk) AND balance >= :amount',
            ExpressionAttributeValues: { ':amount': amount },
          },
        },
        { Put: { TableName: T, Item: { ...marker, fleetId, amount, surge, at: now() }, ConditionExpression: 'attribute_not_exists(pk)' } },
      ],
    })), new HttpError(402, `fondos insuficientes en ${fleetId} para cobrar ${amount}`));

    // En un reintento se devuelve el cobro original, no el recalculado
    const charge = r.item ?? { amount, surge };
    log('info', r.duplicate ? 'cobro duplicado ignorado' : 'cobro realizado', { correlation_id: sagaId, fleetId, ...charge });
    return { amount: charge.amount, surge: charge.surge };
  },

  // Compensación del paso 2: devuelve exactamente lo cobrado, una sola vez
  'POST /charges/:sagaId/refund': async (_body, { sagaId }) => {
    const charge = await getItem(T, { pk: `SAGA#${sagaId}`, sk: 'CHARGE' });
    if (!charge) return { status: 'NOTHING_TO_REFUND' };

    const marker = { pk: `SAGA#${sagaId}`, sk: 'REFUND' };
    const r = await idempotent(T, marker, () => ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: T,
            Key: walletKey(charge.fleetId),
            UpdateExpression: 'SET balance = balance + :amount',
            ExpressionAttributeValues: { ':amount': charge.amount },
          },
        },
        { Put: { TableName: T, Item: { ...marker, fleetId: charge.fleetId, amount: charge.amount, at: now() }, ConditionExpression: 'attribute_not_exists(pk)' } },
      ],
    })), new HttpError(409, 'reembolso en conflicto'));

    log('info', r.duplicate ? 'reembolso duplicado ignorado' : 'reembolso realizado', { correlation_id: sagaId, amount: charge.amount });
    return { status: 'REFUNDED', amount: charge.amount };
  },
});
