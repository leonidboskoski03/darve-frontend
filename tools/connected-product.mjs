import { fork, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  frontendRoot,
  connectedOrigins,
  assertDataDirectory,
  newConnectedState,
  assertConnectedState,
  checkBackendSource,
  readConnectedCredentials,
  connectedServerEnvironment,
  systemChildEnvironment,
} from './connected-product-config.mjs';
import {
  docker,
  ensureConnectedStorage,
  stopConnectedStorage,
  inspectDevelopmentApi,
} from './connected-product-storage.mjs';

const defaultDirectory = path.join(frontendRoot, 'artifacts.local/connected-product');
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw Error('Connected state JSON is invalid; no private values are printed.');
  }
};
const json = (file, value) =>
  writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600, flush: true });
export const portAvailable = (port) =>
  new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
async function startChild(file, args, environment, runId) {
  const child = fork(path.join(frontendRoot, 'tools', file), args, {
    cwd: frontendRoot,
    env: { ...systemChildEnvironment(), ...environment, CONNECTED_RUN_ID: runId },
    execArgv: ['--use-system-ca'],
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(Error('Connected child startup timed out.'));
    }, 30000);
    child.once('error', () => {
      clearTimeout(timeout);
      reject(Error('Connected child could not start.'));
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(Error('Connected child exited before readiness.'));
    });
    child.on('message', (m) => {
      if (m?.type === 'ready') {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  return child;
}
async function stopChild(child, runId) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('Owned connected child required forced shutdown.'));
    }, 10000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (child.connected) child.send({ action: 'stop', runId });
    else child.kill();
  });
}
export async function startConnectedProduct({
  backend = path.resolve(frontendRoot, '../tmp/backend-f06-checkout'),
  credentialsFile = path.resolve(frontendRoot, '../darve-backend/.env'),
  directory = defaultDirectory,
  pauseDevelopmentApi = false,
  purpose = 'product',
} = {}) {
  backend = path.resolve(backend);
  directory = assertDataDirectory(directory);
  if (!['product', 'acceptance'].includes(purpose))
    throw Error('Unknown connected profile purpose.');
  const source = checkBackendSource(backend),
    credentials = readConnectedCredentials(credentialsFile);
  if (!(await portAvailable(5174)))
    throw Error('Frontend port 5174 is occupied. No service was stopped.');
  const apiFree = await portAvailable(3000);
  let pendingPause;
  if (!apiFree) {
    if (!pauseDevelopmentApi)
      throw Error(
        'API port 3000 is occupied. Use --pause-development-api only to temporarily hand over the related darve-backend API; its data is preserved.',
      );
    pendingPause = inspectDevelopmentApi();
    if (!pendingPause.State.Running)
      throw Error('The related development API is not the current port owner.');
  }
  mkdirSync(directory, { recursive: true });
  const stateFile = path.join(directory, 'private.json'),
    runtimeFile = path.join(directory, 'runtime.json'),
    lockFile = path.join(directory, 'owner.json');
  const previous = existsSync(runtimeFile) ? readJson(runtimeFile) : null;
  if (existsSync(lockFile)) {
    const lock = readJson(lockFile);
    if (alive(lock.pid) || [previous?.apiPid, previous?.webPid].some((pid) => pid && alive(pid)))
      throw Error(
        'A connected owner/child may still be active. Inspect its runtime before restarting.',
      );
    unlinkSync(lockFile);
  }
  const runId = randomUUID(),
    lock = openSync(lockFile, 'wx', 0o600);
  closeSync(lock);
  json(lockFile, { pid: process.pid, runId });
  let state,
    apiChild,
    webChild,
    closing,
    paused,
    initialized = false,
    unexpectedExit = false,
    stateAccepted = false;
  const save = () => json(stateFile, state);
  const record = (phase) =>
    json(runtimeFile, {
      schemaVersion: 1,
      phase,
      runId,
      profileId: state?.profileId,
      source,
      pid: process.pid,
      apiPid: apiChild?.pid,
      webPid: webChild?.pid,
      ...connectedOrigins,
      resources: state?.resources,
      migrations: state?.migrationCount,
      restoreRequired: Boolean(paused),
      pausedDevelopmentApi: paused?.id,
      inputAvailability: {
        identityClients: Object.fromEntries(
          ['TWITCH', 'GOOGLE', 'KICK'].map((p) => [p, Boolean(credentials[p + '_CLIENT_ID'])]),
        ),
        developmentTerms: true,
        overlayConfigured: true,
        receiving: 'not configured',
        collectionWorker: 'not started',
        analysis: 'not configured',
        postingBot: 'not configured',
        staffAndResend: 'not configured',
        coins: 'disabled',
      },
    });
  const close = () =>
    (closing ??= (async () => {
      if (!stateAccepted) {
        if (existsSync(lockFile) && readJson(lockFile).runId === runId) unlinkSync(lockFile);
        return;
      }
      record('stopping');
      const results = await Promise.allSettled([
        stopChild(webChild, runId),
        stopChild(apiChild, runId),
      ]);
      try {
        if (state) stopConnectedStorage(state);
      } catch {
        results.push({ status: 'rejected' });
      }
      if (paused) {
        try {
          const current = inspectDevelopmentApi(paused.id);
          if (!current.State.Running) docker(['start', current.Id]);
          paused = null;
        } catch {
          results.push({ status: 'rejected' });
        }
      }
      const clean = results.every((r) => r.status === 'fulfilled');
      record(clean ? 'stopped' : 'cleanup_required');
      if (clean && existsSync(lockFile) && readJson(lockFile).runId === runId) unlinkSync(lockFile);
      if (!clean)
        throw Error(
          'Connected cleanup is incomplete. Inspect this run; private state is retained.',
        );
    })());
  try {
    if (existsSync(stateFile)) {
      state = readJson(stateFile);
      assertConnectedState(state, source);
      if (state.purpose !== purpose) throw Error('Connected profile purpose differs.');
    } else {
      state = { ...newConnectedState(source), purpose };
      save();
    }
    stateAccepted = true;
    if (previous?.restoreRequired) {
      const old = inspectDevelopmentApi(previous.pausedDevelopmentApi);
      if (!old.State.Running) paused = { id: old.Id };
    }
    // Rebuild the checked source; never use an unknown pre-existing dist or load the ordinary .env.
    try {
      execFileSync(
        process.execPath,
        [
          process.env.npm_execpath ??
            path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
          'run',
          'build',
        ],
        {
          cwd: backend,
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: systemChildEnvironment(),
        },
      );
    } catch {
      throw Error('Pinned backend build failed; no private output is printed.');
    }
    if (pendingPause) {
      paused = { id: pendingPause.Id };
      record('handing_over_port');
      docker(['stop', pendingPause.Id]);
    }
    record('initializing_owned_storage');
    const storage = await ensureConnectedStorage({ state, save, backend });
    state.migrationCount = storage.migrations;
    save();
    apiChild = await startChild(
      'connected-product-api.mjs',
      [backend],
      connectedServerEnvironment(backend, state, storage, credentials),
      runId,
    );
    record('starting_frontend');
    webChild = await startChild(
      'connected-product-web.mjs',
      [],
      {
        NODE_ENV: 'development',
        VITE_APP_ENV: 'local',
        VITE_PUBLIC_API_ORIGIN: connectedOrigins.api,
      },
      runId,
    );
    for (const [url, expected] of [
      [connectedOrigins.api + '/health/ready', 200],
      [connectedOrigins.frontend + '/dashboard', 200],
    ]) {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.status !== expected) throw Error('Connected HTTP readiness failed.');
    }
    initialized = true;
    record('ready');
    for (const child of [apiChild, webChild])
      child.once('exit', () => {
        if (!closing && initialized) {
          unexpectedExit = true;
          void close().catch(() => {});
        }
      });
    return {
      runId,
      profileId: state.profileId,
      source,
      migrations: state.migrationCount,
      directory,
      ...connectedOrigins,
      close,
      get healthy() {
        return !closing && !unexpectedExit;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export function connectedStatus(directory = defaultDirectory) {
  directory = assertDataDirectory(directory);
  const file = path.join(directory, 'runtime.json');
  if (!existsSync(file)) return { phase: 'not_started', ...connectedOrigins };
  const data = readJson(file);
  const keys = [
    'schemaVersion',
    'phase',
    'runId',
    'profileId',
    'source',
    'pid',
    'apiPid',
    'webPid',
    'resources',
    'migrations',
    'restoreRequired',
    'pausedDevelopmentApi',
    'inputAvailability',
  ];
  return {
    ...Object.fromEntries(keys.filter((k) => data[k] !== undefined).map((k) => [k, data[k]])),
    ...connectedOrigins,
    ownerAlive: alive(data.pid),
  };
}
export async function checkConnectedProduct({
  backend = path.resolve(frontendRoot, '../tmp/backend-f06-checkout'),
  credentialsFile = path.resolve(frontendRoot, '../darve-backend/.env'),
  directory = defaultDirectory,
} = {}) {
  directory = assertDataDirectory(directory);
  const source = checkBackendSource(backend),
    credentials = readConnectedCredentials(credentialsFile);
  const stateFile = path.join(directory, 'private.json');
  if (existsSync(stateFile)) assertConnectedState(readJson(stateFile), source);
  docker(['version', '--format', '{{.Server.Version}}']);
  return {
    ...connectedOrigins,
    source,
    persistentProfilePresent: existsSync(stateFile),
    frontendPortFree: await portAvailable(5174),
    apiPortFree: await portAvailable(3000),
    providerClientInputs: Object.fromEntries(
      ['TWITCH', 'GOOGLE', 'KICK'].map((p) => [p, Boolean(credentials[p + '_CLIENT_ID'])]),
    ),
    currentRuntime: connectedStatus(directory),
    readOnly: true,
    ordinaryMigrationPerformed: false,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? 'start';
  try {
    if (action === 'check') {
      console.log(JSON.stringify(await checkConnectedProduct(), null, 2));
    } else if (action === 'status') {
      console.log(JSON.stringify(connectedStatus(), null, 2));
    } else if (action === 'stop') {
      const status = connectedStatus();
      if (status.phase !== 'ready' || !status.ownerAlive)
        throw Error('No ready connected owner. Inspect product:status for interrupted cleanup.');
      json(path.join(defaultDirectory, 'stop.json'), { action: 'stop', runId: status.runId });
      console.log(
        'Graceful stop requested. Owned data is retained; a paused development API is restored.',
      );
    } else if (action === 'start') {
      if (process.argv.slice(3).some((arg) => arg !== '--pause-development-api'))
        throw Error('Unsupported connected startup option.');
      const product = await startConnectedProduct({
        pauseDevelopmentApi: process.argv.includes('--pause-development-api'),
      });
      console.log('Connected Darve: ' + product.frontend + ' (API ' + product.api + ').');
      console.log(
        'Current pinned source; ' +
          product.migrations +
          ' owned migrations. Login uses real configured providers; no fixture login is available.',
      );
      console.log(
        'Receiving, collector/model/bot, staff email and coins remain unavailable until their owners configure them.',
      );
      console.log(
        'Ctrl+C or npm run product:stop stops this profile, preserves its data and restores the handed-over API.',
      );
      let finishing;
      const stop = () =>
        (finishing ??= (async () => {
          clearInterval(timer);
          await product.close();
        })());
      const finish = (code) => {
        void stop()
          .then(() => process.exit(code))
          .catch(() => {
            process.stderr.write('Connected cleanup requires inspection of product:status.\n');
            process.exit(1);
          });
      };
      const timer = setInterval(() => {
        if (!product.healthy) {
          finish(1);
          return;
        }
        const file = path.join(defaultDirectory, 'stop.json');
        if (!existsSync(file)) return;
        try {
          const message = readJson(file);
          if (message.action === 'stop' && message.runId === product.runId) finish(0);
        } catch {
          /* A partial/mismatched stop file has no authority. */
        }
      }, 300);
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => finish(0));
    } else throw Error('Use check, start, status or stop.');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
