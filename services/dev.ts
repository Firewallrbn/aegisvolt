// Levanta los 4 servicios en local contra Floci: npm run dev
import { spawn } from 'node:child_process';

const services = ['station-reservation', 'billing-wallet', 'energy-dispatch', 'graphql-gateway'];
const children = services.map((s) =>
  spawn(process.execPath, ['--env-file=floci.env', `${s}/index.ts`], { stdio: 'inherit' }),
);
process.on('SIGINT', () => children.forEach((c) => c.kill()));
