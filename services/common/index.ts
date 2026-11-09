// Utilidades compartidas: logs JSON, DynamoDB, feature flags, servidor HTTP mínimo e idempotencia.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname } from 'node:path';
import { CloudWatchLogsClient, CreateLogStreamCommand, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

export const ENV = process.env.APP_ENV ?? 'dev';
// El nombre del servicio es su carpeta: station-reservation, billing-wallet, ...
export const SERVICE = process.env.SERVICE ?? basename(dirname(process.argv[1] ?? 'local/x'));
export const table = (name: string): string => `aegisvolt-${name}-${ENV}`;
export const now = (): string => new Date().toISOString();

// Endpoint, región y credenciales salen de AWS_ENDPOINT_URL / AWS_REGION / AWS_ACCESS_KEY_ID (Floci)
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// CloudWatch: cada servicio envía sus logs a /aegisvolt/<env>/<servicio>, un stream por pod (HOSTNAME).
// shortcut: envío desde la app en lotes de 1 s (sin Fluent Bit, por RAM); si el pod muere se pierde el último segundo.
const cwl = new CloudWatchLogsClient({});
const logGroup = `/aegisvolt/${ENV}/${SERVICE}`;
const logStream = process.env.HOSTNAME ?? `local-${process.pid}`;
let pending: { timestamp: number; message: string }[] = [];
let shipping = process.env.LOG_TO_CLOUDWATCH !== 'false';
const streamReady = shipping ? openStream() : Promise.resolve();

async function openStream(): Promise<void> {
  try {
    await cwl.send(new CreateLogStreamCommand({ logGroupName: logGroup, logStreamName: logStream }));
  } catch (e) {
    if ((e as Error).name === 'ResourceAlreadyExistsException') return; // reinicio del mismo pod
    // El grupo lo crea Terraform; sin él (CI, tests) o sin CloudWatch, se sigue logueando solo a stdout
    shipping = false;
    console.log(JSON.stringify({ level: 'warn', msg: `logs solo a stdout (${logGroup}): ${(e as Error).name}` }));
  }
}

async function flushLogs(): Promise<void> {
  if (!shipping || pending.length === 0) return;
  const logEvents = pending;
  pending = [];
  try {
    await streamReady;
    if (shipping) await cwl.send(new PutLogEventsCommand({ logGroupName: logGroup, logStreamName: logStream, logEvents }));
  } catch (e) {
    console.log(JSON.stringify({ level: 'warn', msg: 'no se pudieron enviar logs a CloudWatch', error: (e as Error).message }));
  }
}
setInterval(flushLogs, 1000).unref();

export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  const message = JSON.stringify({ timestamp: now(), level, env: ENV, service: SERVICE, msg, ...fields });
  console.log(message);
  if (shipping) pending.push({ timestamp: Date.now(), message });
}

export async function getItem(tableName: string, key: Record<string, string>): Promise<Record<string, any> | undefined> {
  return (await ddb.send(new GetCommand({ TableName: tableName, Key: key }))).Item;
}

// Se lee en cada uso (sin caché): un cambio en la tabla de flags aplica sin redesplegar
export async function flag(name: string): Promise<boolean> {
  return (await getItem(table('flags'), { name }))?.enabled === true;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const isConditionFailure = (e: unknown): boolean =>
  ['TransactionCanceledException', 'ConditionalCheckFailedException'].includes((e as Error).name);

/**
 * Idempotencia: `write` incluye un Put condicional (attribute_not_exists) del registro `marker`.
 * Si la escritura falla por condición y el marker ya existe, la petición es un duplicado: se devuelve el marker
 * sin repetir el efecto. Si el marker no existe, falló la regla de negocio y se lanza `conflict`.
 */
export async function idempotent(
  tableName: string,
  marker: { pk: string; sk: string },
  write: () => Promise<unknown>,
  conflict: HttpError,
): Promise<{ duplicate: boolean; item?: Record<string, any> }> {
  try {
    await write();
    return { duplicate: false };
  } catch (e) {
    if (!isConditionFailure(e)) throw e;
    const item = await getItem(tableName, marker);
    if (item) return { duplicate: true, item };
    throw conflict;
  }
}

/** Llamada HTTP entre servicios; propaga el correlation_id y convierte errores en HttpError. */
export async function call(baseUrl: string, method: string, path: string, body: unknown, correlationId: string): Promise<any> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, data.error ?? `HTTP ${res.status}`);
  return data;
}

export type Handler = (body: any, params: Record<string, string>) => Promise<unknown>;

/** Servidor HTTP con rutas "MÉTODO /ruta/:param", /health automático, CORS y errores en JSON. */
export function serve(port: number, routes: Record<string, Handler>): void {
  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, path = ''] = key.split(' ');
    const names: string[] = [];
    const pattern = path.replace(/:(\w+)/g, (_, name: string) => (names.push(name), '([^/]+)'));
    return { method, regex: new RegExp(`^${pattern}$`), names, handler };
  });

  createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, x-correlation-id');
    if (req.method === 'OPTIONS') return send(res, 204);

    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, service: SERVICE, env: ENV });

    for (const route of compiled) {
      const match = route.method === req.method ? route.regex.exec(path) : null;
      if (!match) continue;
      const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(match[i + 1] ?? '')]));
      try {
        return send(res, 200, await route.handler(await readJson(req), params));
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        log(status >= 500 ? 'error' : 'warn', (e as Error).message, {
          status, path, correlation_id: req.headers['x-correlation-id'],
        });
        return send(res, status, { error: (e as Error).message });
      }
    }
    send(res, 404, { error: 'ruta no encontrada' });
  }).listen(port, () => log('info', `escuchando en :${port}`));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) return void res.writeHead(status).end();
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
