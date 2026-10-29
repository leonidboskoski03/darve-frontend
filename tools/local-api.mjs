import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertProviderLoginRuntime } from './provider-login-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const postgresImage =
  'pgvector/pgvector:0.8.7-pg16@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a';
const redisImage = 'redis@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499';
const run = (command, args, options = {}) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    }).trim();
  } catch {
    throw new Error(
      `Isolated API command failed: ${path.basename(command)}. No private command arguments are logged.`,
    );
  }
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Operator tooling only: fresh labelled tmpfs storage. Provider configuration requires explicit opt-in. */
export async function startLocalApi({
  backend,
  origins = ['http://127.0.0.1:5173', 'http://127.0.0.1:4175'],
  port = 3310,
  build = true,
  task = 'f02-02',
  overlay = false,
  terms = false,
  operatorOAuth,
  collection = false,
}) {
  if (!['f02-02', 'f02-03', 'f03', 'f03-live', 'f04-02'].includes(task))
    throw new Error('Invalid local task identity.');
  const providerEnvironment = assertProviderLoginRuntime({ task, port, origins, operatorOAuth });
  if (collection && task !== 'f04-02')
    throw new Error('Controlled collection ports require their explicit disposable task.');
  backend = path.resolve(backend);
  const provenance = JSON.parse(
    readFileSync(path.join(root, 'vendor/contracts/provenance.json'), 'utf8'),
  );
  if (run('git', ['rev-parse', 'HEAD'], { cwd: backend }) !== provenance.sourceRevision)
    throw new Error('Backend source differs from the pinned contracts.');
  const buildInputs = [
    'apps',
    'packages',
    'infra',
    'package.json',
    'package-lock.json',
    'tsconfig*.json',
    '.npmrc',
  ];
  run('git', ['diff', '--exit-code', provenance.sourceRevision, '--', ...buildInputs], {
    cwd: backend,
  });
  if (
    run('git', ['ls-files', '--others', '--exclude-standard', '--', ...buildInputs], {
      cwd: backend,
    })
  )
    throw new Error('Untracked backend build inputs require review.');
  if (!Number.isInteger(port) || port < 1024) throw new Error('Use a separate local API port.');
  run('docker', ['version', '--format', '{{.Server.Version}}']);
  if (build)
    run(
      process.execPath,
      [
        process.env.npm_execpath ??
          path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
        'run',
        'build',
      ],
      { cwd: backend },
    );
  const runId = randomUUID();
  const containers = [];
  let deps;
  let server;
  let closing;
  const owned = (id) =>
    run('docker', ['inspect', '--format', '{{index .Config.Labels "darve.frontend.run"}}', id]) ===
    runId;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      const errors = [];
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        server = null;
      }
      if (deps) {
        try {
          await deps.close();
        } catch {
          errors.push('API dependency cleanup failed.');
        }
        deps = null;
      }
      for (const id of containers.splice(0)) {
        try {
          if (!owned(id)) throw new Error('Container ownership could not be verified.');
          run('docker', ['rm', '-f', id]);
        } catch {
          errors.push('Labelled container cleanup failed; inspect this run before removal.');
        }
      }
      if (errors.length) throw new Error(errors.join(' '));
    })();
    return closing;
  };
  try {
    const dbPassword = randomBytes(32).toString('hex');
    const redisPassword = randomBytes(32).toString('hex');
    const common = [
      'run',
      '-d',
      '--rm',
      '--label',
      `darve.frontend.task=${task}`,
      '--label',
      `darve.frontend.run=${runId}`,
    ];
    const postgres = run('docker', [
      ...common,
      '-p',
      '127.0.0.1::5432',
      '--tmpfs',
      '/var/lib/postgresql/data',
      '-e',
      'POSTGRES_USER=frontend',
      '-e',
      `POSTGRES_PASSWORD=${dbPassword}`,
      '-e',
      'POSTGRES_DB=darve_frontend',
      postgresImage,
    ]);
    containers.push(postgres);
    const redis = run('docker', [
      ...common,
      '-p',
      '127.0.0.1::6379',
      '--tmpfs',
      '/data',
      redisImage,
      'redis-server',
      '--save',
      '',
      '--appendonly',
      'no',
      '--requirepass',
      redisPassword,
    ]);
    containers.push(redis);
    const dbPort = Number(run('docker', ['port', postgres, '5432/tcp']).split(':').at(-1));
    const redisPort = Number(run('docker', ['port', redis, '6379/tcp']).split(':').at(-1));
    if (!dbPort || dbPort === 5432 || !redisPort || redisPort === 6379)
      throw new Error('Isolated storage ports were not assigned.');
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        run('docker', ['exec', postgres, 'pg_isready', '-U', 'frontend', '-d', 'darve_frontend']);
        break;
      } catch {
        if (attempt === 39) throw new Error('Isolated PostgreSQL readiness timed out.');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    const databaseUrl = `postgresql://frontend:${dbPassword}@127.0.0.1:${dbPort}/darve_frontend`;
    run(
      process.execPath,
      [
        path.join(backend, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        'packages/database/prisma.config.ts',
      ],
      { cwd: backend, env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
    const { readApiEnvironment } = await import(
      pathToFileURL(path.join(backend, 'apps/api/dist/config/environment.js')).href
    );
    const { createApp } = await import(
      pathToFileURL(path.join(backend, 'apps/api/dist/app.js')).href
    );
    const { createDependencies } = await import(
      pathToFileURL(path.join(backend, 'apps/api/dist/composition/runtime.js')).href
    );
    const { createLogger } = await import(
      pathToFileURL(path.join(backend, 'apps/api/dist/logging/logger.js')).href
    );
    let termsRevision = 1;
    const termsFile = path.join(root, `artifacts.local/${task}/terms-${runId}.json`);
    const writeTermsFixture = () => {
      const content = `Development acceptance fixture. Not a public policy.\n\nDocument synthetic-v${termsRevision}.\nAcknowledgement is used only to test exact version/hash handling in a disposable local database.\n\nLiteral markup: <b>plain text only</b>.`;
      mkdirSync(path.dirname(termsFile), { recursive: true });
      writeFileSync(
        termsFile,
        JSON.stringify({
          documentId: 'local-acceptance',
          version: `synthetic-v${termsRevision}`,
          classification: 'development',
          contentHash: sha256(content),
          content,
        }),
      );
    };
    if (terms) writeTermsFixture();
    const runtimeInput = {
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: port,
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      REDIS_URL: `redis://:${redisPassword}@127.0.0.1:${redisPort}`,
      CORS_ORIGINS: origins.join(','),
      RATE_LIMIT_MAX: 1000,
      ...(collection
        ? {
            CREDENTIAL_ENCRYPTION_KEY_ID: 'collection-fixture',
            CREDENTIAL_ENCRYPTION_KEY_BASE64: randomBytes(32).toString('base64'),
            TWITCH_CLIENT_ID: 'a'.repeat(20),
            TWITCH_CLIENT_SECRET: 'a'.repeat(30),
            GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
            GOOGLE_CLIENT_SECRET: 'a'.repeat(30),
            KICK_CLIENT_ID: 'a'.repeat(26),
            KICK_CLIENT_SECRET: 'a'.repeat(30),
          }
        : {}),
      ...providerEnvironment,
      ...(terms ? { TERMS_POLICY_FILE: termsFile } : {}),
      ...(overlay
        ? {
            OVERLAY_PRESENTATION_BASE_URL: origins[0] + '/tests/fixtures/realtime.html/',
            OVERLAY_GRANT_EPOCH: randomUUID(),
            OVERLAY_SSE_POLL_MS: 250,
          }
        : {}),
    };
    let config = readApiEnvironment(runtimeInput);
    const logger = createLogger('silent');
    deps = createDependencies(config, logger);
    const ready = await deps.checkReadiness();
    if (ready.status !== 'ready') throw new Error('Isolated runtime dependencies are unavailable.');
    const collectionFixture = collection
      ? await (
          await import('./local-collection-fixture.mjs')
        ).createLocalCollectionFixture(backend, deps.database, config)
      : null;
    const listen = () =>
      new Promise((resolve, reject) => {
        const listener = createApp(config, logger, {
          ...deps,
          ...collectionFixture?.dependencies,
        }).listen(port, '127.0.0.1', () => resolve(listener));
        listener.once('error', reject);
      });
    server = await listen();
    const migrationRows = await deps.database
      .$queryRaw`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    const state = {
      runId,
      apiOrigin: `http://127.0.0.1:${port}`,
      pid: process.pid,
      containers: [...containers],
      postgresPort: dbPort,
      redisPort,
      migrations: migrationRows[0].count,
      source: provenance.sourceRevision,
    };
    mkdirSync(path.join(root, `artifacts.local/${task}`), { recursive: true });
    writeFileSync(
      path.join(root, `artifacts.local/${task}/runtime.json`),
      JSON.stringify(state, null, 2),
    );
    const { sessionCsrfProof } = await import(
      pathToFileURL(path.join(backend, 'apps/api/dist/security/proofs.js')).href
    );
    return {
      ...state,
      collectionFixture,
      close,
      // Node-only network-fault probe; no HTTP route or database effect.
      interruptConnections: () => server.closeAllConnections(),
      // Node-only source/config restart for stale-terms acceptance; no operator HTTP endpoint.
      async replaceTermsFixture({ configured = true } = {}) {
        if (task !== 'f03' || !terms)
          throw new Error('Terms replacement requires the F03 disposable fixture.');
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        server = undefined;
        if (configured) {
          termsRevision++;
          writeTermsFixture();
        }
        config = readApiEnvironment({
          ...runtimeInput,
          TERMS_POLICY_FILE: configured ? termsFile : '',
        });
        await deps.close();
        deps = createDependencies(config, logger);
        const readiness = await deps.checkReadiness();
        if (readiness.status !== 'ready')
          throw new Error('Replacement fixture runtime is unavailable.');
        server = await listen();
      },
      // Node-only acceptance fixture. This is never an HTTP login endpoint or product shortcut.
      async seedSession({ expiresInMs = 60_000 } = {}) {
        const secret = randomBytes(32).toString('base64url');
        const user = await deps.database.darveUser.create({
          data: { displayName: 'Synthetic local creator' },
        });
        await deps.database.externalIdentity.create({
          data: {
            userId: user.id,
            provider: 'TWITCH',
            issuer: 'https://synthetic.invalid',
            subject: randomUUID(),
          },
        });
        const session = await deps.database.darveSession.create({
          data: {
            userId: user.id,
            secretHash: sha256(secret),
            csrfHash: sha256(sessionCsrfProof(secret)),
            expiresAt: new Date(Date.now() + expiresInMs),
          },
        });
        return { secret, userId: user.id, sessionId: session.id };
      },
      async revoked(sessionId) {
        const value = await deps.database.darveSession.findUnique({ where: { id: sessionId } });
        return Boolean(value?.revokedAt);
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const api = await startLocalApi({ backend: process.argv[2] ?? '../darve-backend' });
  console.log(
    `Isolated API ready at ${api.apiOrigin}; ${api.migrations} migrations; providers OFF. Ctrl+C stops this run's API and labelled storage.`,
  );
  const stop = () => {
    void api.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
