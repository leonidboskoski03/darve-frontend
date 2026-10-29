import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { startLocalApi } from './local-api.mjs';
import { providerLoginOrigins, isProviderLoginStopRequest } from './provider-login-config.mjs';

if (process.argv.includes('--stop')) {
  const current = JSON.parse(readFileSync('artifacts.local/f03-live/operator.json', 'utf8'));
  if (!isProviderLoginStopRequest({ action: 'stop', runId: current.runId }, current.runId))
    throw new Error('No valid operator run recorded.');
  writeFileSync(
    'artifacts.local/f03-live/stop.json',
    JSON.stringify({ action: 'stop', runId: current.runId }),
  );
  console.log('Graceful stop requested for the recorded provider-login run.');
  process.exit(0);
}

const backend = resolve(process.argv[2] ?? '../darve-backend');
// Private server inputs only: never expose these in process-wide VITE variables or output.
const privateInput = parseEnv(readFileSync(resolve(backend, '.env'), 'utf8'));
let api, vite, closing, pausedContainer, stopTimer;
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const close = () => {
  if (closing) return closing;
  closing = (async () => {
    clearInterval(stopTimer);
    const results = await Promise.allSettled([vite?.close(), api?.close()]);
    if (pausedContainer) {
      // Restore the exact existing API container, never an arbitrary replacement or storage group.
      docker(['start', pausedContainer]);
      writeFileSync(
        'artifacts.local/f03-live/restore.json',
        JSON.stringify(
          { containerId: pausedContainer, name: 'darve-backend-api-1', restoreRequired: false },
          null,
          2,
        ),
      );
      pausedContainer = undefined;
    }
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('Owned provider-login cleanup failed; inspect exact run metadata.');
  })();
  return closing;
};
try {
  if (process.argv.includes('--pause-development-api')) {
    const state = docker([
      'inspect',
      '--format',
      '{{.Id}} {{.State.Running}}',
      'darve-backend-api-1',
    ]).split(' ');
    if (state.length !== 2 || state[1] !== 'true')
      throw new Error('Expected running development API not found.');
    pausedContainer = state[0];
    mkdirSync('artifacts.local/f03-live', { recursive: true });
    writeFileSync(
      'artifacts.local/f03-live/restore.json',
      JSON.stringify(
        { containerId: pausedContainer, name: 'darve-backend-api-1', restoreRequired: true },
        null,
        2,
      ),
    );
    docker(['stop', pausedContainer]);
  }
  api = await startLocalApi({
    backend,
    origins: [providerLoginOrigins.frontend],
    port: 3000,
    task: 'f03-live',
    operatorOAuth: privateInput,
    // Development-only document; not a public policy or legal acceptance claim.
    terms: true,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = providerLoginOrigins.api;
  vite = await createServer({
    clearScreen: false,
    envDir: false,
    server: { host: '127.0.0.1', port: 5174, strictPort: true, hmr: false },
  });
  await vite.listen();
  mkdirSync('artifacts.local/f03-live', { recursive: true });
  writeFileSync(
    'artifacts.local/f03-live/operator.json',
    JSON.stringify(
      {
        pid: process.pid,
        runId: api.runId,
        frontend: providerLoginOrigins.frontend,
        api: providerLoginOrigins.api,
        syntheticLogin: false,
        source: api.source,
        migrations: api.migrations,
      },
      null,
      2,
    ),
  );
  console.log(
    'Real-provider operator runtime ready: http://localhost:5174/authorize. No synthetic login is supplied. Run provider:local -- --stop for graceful cleanup.',
  );
  // No HTTP control endpoint. A matching run-bound local stop file works with Windows tool pipes.
  stopTimer = setInterval(() => {
    let request;
    try {
      request = JSON.parse(readFileSync('artifacts.local/f03-live/stop.json', 'utf8'));
    } catch {
      return;
    }
    if (isProviderLoginStopRequest(request, api.runId))
      void close()
        .then(() => process.exit(0))
        .catch(() => {
          process.stderr.write('Owned provider-login cleanup failed.\n');
          process.exit(1);
        });
  }, 300);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void close().then(() => process.exit(0));
    });
} catch {
  await close();
  process.stderr.write(
    'Provider-login setup failed. No private configuration is printed. Inspect ports and pinned source.\n',
  );
  process.exitCode = 1;
}
