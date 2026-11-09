// Cliente GraphQL por ambiente. Vite enruta /gw/<env> al API Gateway de ese ambiente (ver vite.config.ts).
export const ENVS = ['dev', 'test', 'prod'] as const;
export type Env = (typeof ENVS)[number];

export type Connector = { id: string; status: string; powerKw: number; ultra: boolean; sagaId?: string | null };
export type Station = { id: string; connectors: Connector[] };
export type Flag = { name: string; enabled: boolean };
export type Wallet = { fleetId: string; balance: number };
export type SagaStep = { step: string; status: string; at: string; error?: string | null };
export type Saga = {
  id: string; status: string; stationId: string; connectorId: string; fleetId: string; kwh: number;
  amount?: number | null; error?: string | null; steps: SagaStep[]; createdAt: string; updatedAt?: string | null;
};
export type Telemetry = { sagaId: string; status: string; powerKw: number; kwhDelivered: number; startedAt: string };
export type Snapshot = { env: string; stations: Station[]; flags: Flag[]; sagas: Saga[]; wallets: Wallet[] };

export const FLEETS = ['fleet-andina', 'fleet-sin-saldo'];
export const PRICE_PER_KWH = 1.2; // mismo valor que billing-wallet
export const SURGE = 1.5;

async function gql<T>(env: Env, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/gw/${env}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${env} respondió HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

const SAGA_FIELDS = 'id status stationId connectorId fleetId kwh amount error steps { step status at error } createdAt updatedAt';

export async function snapshot(env: Env): Promise<Snapshot> {
  const d = await gql<any>(env, `{
    env
    stations { id connectors { id status powerKw ultra sagaId } }
    flags { name enabled }
    sagas { ${SAGA_FIELDS} }
    ${FLEETS.map((f, i) => `w${i}: wallet(fleetId: "${f}") { fleetId balance }`).join('\n')}
  }`);
  return { ...d, wallets: FLEETS.map((_, i) => d[`w${i}`]).filter(Boolean) };
}

export const health = async (env: Env): Promise<boolean> =>
  fetch(`/gw/${env}/health`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok, () => false);

export const reserveAndCharge = (env: Env, v: { stationId: string; connectorId: string; fleetId: string; kwh: number }) =>
  gql<{ reserveAndCharge: Saga }>(env, `mutation($stationId: ID!, $connectorId: ID!, $fleetId: ID!, $kwh: Float!) {
    reserveAndCharge(stationId: $stationId, connectorId: $connectorId, fleetId: $fleetId, kwh: $kwh) { ${SAGA_FIELDS} }
  }`, v).then((d) => d.reserveAndCharge);

export const finishCharge = (env: Env, sagaId: string) =>
  gql<{ finishCharge: Saga }>(env, `mutation($id: ID!) { finishCharge(sagaId: $id) { id status } }`, { id: sagaId });

export const setFlag = (env: Env, name: string, enabled: boolean) =>
  gql<{ setFlag: Flag }>(env, `mutation($n: String!, $e: Boolean!) { setFlag(name: $n, enabled: $e) { name enabled } }`,
    { n: name, e: enabled });

export const telemetry = (env: Env, sagaId: string) =>
  gql<{ telemetry: Telemetry | null }>(env, `query($id: ID!) { telemetry(sagaId: $id) {
    sagaId status powerKw kwhDelivered startedAt } }`, { id: sagaId }).then((d) => d.telemetry);

// Ubicación de cada estación (Bogotá). shortcut: vive en el frontend; si hay más estaciones, mover lat/lng a DynamoDB.
export const STATION_INFO: Record<string, { name: string; area: string; lngLat: [number, number] }> = {
  'st-norte': { name: 'Estación Norte', area: 'Usaquén · Autopista Norte', lngLat: [-74.0445, 4.7005] },
  'st-sur': { name: 'Estación Sur', area: 'Kennedy · Av. Américas', lngLat: [-74.1405, 4.6285] },
};

export const FLAG_INFO: Record<string, { label: string; effect: string }> = {
  ENABLE_DYNAMIC_SURGE_PRICING: { label: 'Precio dinámico', effect: 'Cobra ×1.5 el kWh en hora pico' },
  ENABLE_FAST_CHARGE_BOOST: { label: 'Ultra-carga', effect: 'Habilita conectores de 150 kW o más' },
  SIMULATE_CHARGER_HARDWARE_FAULT: { label: 'Falla física simulada', effect: 'El cargador falla al activar: fuerza la compensación' },
};
