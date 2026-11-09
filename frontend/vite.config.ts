// /gw/<env>/... -> API Gateway HTTP API de ese ambiente en Floci (http://localhost:4566/execute-api/<apiId>/$default/...).
// Los apiId cambian si se recrea la infra, así que se leen de Floci al arrancar Vite.
import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

const FLOCI = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';

function apiIds(): Record<string, string> {
  try {
    const out = execSync(`aws apigatewayv2 get-apis --endpoint-url ${FLOCI} --region us-east-1 --output json`, {
      env: { ...process.env, AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_PAGER: '' },
      encoding: 'utf8',
    });
    const items: { Name: string; ApiId: string }[] = JSON.parse(out).Items ?? [];
    return Object.fromEntries(items.map((a) => [a.Name.replace('aegisvolt-', ''), a.ApiId]));
  } catch (e) {
    console.warn(`[aegisvolt] no se pudieron leer las APIs de Floci (${(e as Error).message}); el frontend no tendrá backend`);
    return {};
  }
}

const proxy: Record<string, ProxyOptions> = {};
for (const [env, id] of Object.entries(apiIds())) {
  proxy[`/gw/${env}`] = {
    target: FLOCI,
    changeOrigin: true,
    rewrite: (path) => path.replace(`/gw/${env}`, `/execute-api/${id}/$default`),
  };
  console.log(`[aegisvolt] ${env} -> ${FLOCI}/execute-api/${id}/$default`);
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
});
