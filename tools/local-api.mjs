import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertProviderLoginRuntime } from './provider-login-config.mjs';
import { assertLifecycleComposition } from './local-lifecycle-config.mjs';
import {
  assertPaymentSandboxSelection,
  readPaymentSandboxConfiguration,
} from './payment-sandbox-config.mjs';

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
  review = false,
  reporting = false,
  contributionReads = false,
  checkout = false,
  sandboxPayment,
  qrPublicOrigin,
  support = false,
  coins = false,
  receiving = false,
  sellerObservation,
}) {
  const walkthrough = task === 'f01-05';
  const handoff = task === 'f06-06' || walkthrough;
  const seller = task === 'f06-06-seller';
  const staffLifecycle = task === 'f10-04';
  const fundedLifecycle = task === 'f10-03' || staffLifecycle;
  const fundedSandbox = task === 'f10-03-sandbox';
  if (
    (handoff || seller || sellerObservation !== undefined) &&
    ((!handoff && !seller) ||
      (handoff
        ? !receiving || !collection || !review || sellerObservation !== undefined
        : receiving ||
          collection ||
          review ||
          sellerObservation?.approval !== 'F06-06' ||
          !['stripe', 'paypal'].includes(sellerObservation?.provider) ||
          typeof sellerObservation?.sourceRoot !== 'string') ||
      !terms ||
      port !== (handoff ? 3311 : 3310) ||
      origins.length !== 1 ||
      origins[0] !==
        (walkthrough
          ? 'http://localhost:4177'
          : handoff
            ? 'http://127.0.0.1:4177'
            : 'http://127.0.0.1:4175') ||
      reporting ||
      overlay !== walkthrough ||
      contributionReads ||
      checkout ||
      sandboxPayment !== undefined ||
      operatorOAuth !== undefined ||
      qrPublicOrigin !== undefined ||
      support ||
      coins)
  )
    throw Error('Receiving handoff requires its exact disposable F06-06 or F01-05 composition.');
  if (
    !handoff &&
    (receiving || task === 'f03-04') &&
    (task !== 'f03-04' ||
      !terms ||
      port !== 3310 ||
      origins.length !== 1 ||
      origins[0] !== 'http://127.0.0.1:4175' ||
      overlay ||
      operatorOAuth !== undefined ||
      collection ||
      review ||
      reporting ||
      contributionReads ||
      checkout ||
      sandboxPayment !== undefined ||
      qrPublicOrigin !== undefined ||
      support ||
      coins)
  )
    throw Error('Receiving qualification requires its exact disposable provider-free composition.');
  if (task === 'f10-02' || fundedLifecycle)
    assertLifecycleComposition({
      task,
      port,
      origins,
      collection,
      review,
      reporting,
      terms,
      overlay,
      contributionReads,
      checkout,
      sandboxPayment,
      operatorOAuth,
      qrPublicOrigin,
      support,
      coins,
    });
  if (
    !staffLifecycle &&
    (coins ||
      ['f09-02', 'f09-g01', 'f09-03', 'f09-04', 'f09-05', 'f09-06', 'f09-07'].includes(task)) &&
    (!coins ||
      !['f09-02', 'f09-g01', 'f09-03', 'f09-04', 'f09-05', 'f09-06', 'f09-07'].includes(task) ||
      (['f09-06', 'f09-07'].includes(task) ? !support : support) ||
      (['f09-03', 'f09-05', 'f09-07'].includes(task)
        ? !collection || !review || !terms
        : collection || review || terms) ||
      reporting ||
      (['f09-05', 'f09-07'].includes(task) ? !overlay : overlay) ||
      checkout ||
      contributionReads ||
      sandboxPayment ||
      operatorOAuth ||
      port !== 3310 ||
      origins.length !== 1 ||
      origins[0] !== 'http://127.0.0.1:4175')
  )
    throw new Error('Coins require their exact disposable read/journal composition.');
  if (
    qrPublicOrigin !== undefined &&
    (task !== 'f07' ||
      !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(qrPublicOrigin))
  )
    throw new Error('Mobile QR origin requires its explicit F07 HTTPS test.');
  if (
    ![
      'f01-05',
      'f02-02',
      'f02-03',
      'f03',
      'f03-04',
      'f03-live',
      'f04-02',
      'f04-03',
      'f05',
      'f06',
      'f06-03',
      'f06-04',
      'f06-06',
      'f06-06-seller',
      'f07',
      'f08-04',
      'f08-05',
      'f08-06',
      'f08-07',
      'f08-08',
      'f09-02',
      'f09-g01',
      'f09-03',
      'f09-04',
      'f09-05',
      'f09-06',
      'f09-07',
      'f10-02',
      'f10-03',
      'f10-04',
      'f10-03-sandbox',
    ].includes(task)
  )
    throw new Error('Invalid local task identity.');
  if (
    !staffLifecycle &&
    (support ||
      ['f08-04', 'f08-05', 'f08-06', 'f08-07', 'f08-08', 'f09-06', 'f09-07'].includes(task)) &&
    (!support ||
      !['f08-04', 'f08-05', 'f08-06', 'f08-07', 'f08-08', 'f09-06', 'f09-07'].includes(task) ||
      (task === 'f09-07'
        ? !coins || !collection || !review || !overlay || !terms
        : collection || review || overlay || terms) ||
      reporting ||
      checkout ||
      contributionReads ||
      sandboxPayment ||
      operatorOAuth ||
      port !== 3310 ||
      origins.length !== 1 ||
      origins[0] !== 'http://127.0.0.1:4175')
  )
    throw new Error(
      'Creator support acceptance requires its exact disposable, provider-free composition.',
    );
  assertPaymentSandboxSelection({
    task,
    port,
    origins,
    sandboxPayment,
    collection,
    review,
    checkout,
    contributionReads,
    reporting,
    operatorOAuth,
    overlay,
    terms,
    qrPublicOrigin,
  });
  const providerEnvironment = assertProviderLoginRuntime({ task, port, origins, operatorOAuth });
  if (
    collection &&
    ![
      'f01-05',
      'f04-02',
      'f04-03',
      'f05',
      'f06',
      'f06-03',
      'f06-04',
      'f06-06',
      'f07',
      'f09-03',
      'f09-05',
      'f09-07',
      'f10-02',
      'f10-03',
      'f10-04',
      'f10-03-sandbox',
    ].includes(task)
  )
    throw new Error('Controlled collection ports require their explicit disposable task.');
  if (
    review &&
    (![
      'f01-05',
      'f04-03',
      'f05',
      'f06',
      'f06-03',
      'f06-04',
      'f06-06',
      'f07',
      'f09-03',
      'f09-05',
      'f09-07',
      'f10-02',
      'f10-03',
      'f10-04',
      'f10-03-sandbox',
    ].includes(task) ||
      !collection)
  )
    throw new Error('Controlled review requires its explicit disposable collection task.');
  if (reporting && (!['f05', 'f10-02'].includes(task) || !collection || !review))
    throw new Error('Controlled reporting requires its explicit disposable review task.');
  if (contributionReads && (task !== 'f06' || !collection || !review))
    throw new Error('Controlled receipt reads require their explicit disposable review task.');
  if (
    checkout &&
    ((!fundedLifecycle && task !== 'f06-03') ||
      !collection ||
      !review ||
      contributionReads ||
      reporting ||
      operatorOAuth !== undefined)
  )
    throw new Error(
      'Controlled checkout requires its exact disposable review composition without operator credentials.',
    );
  if (task === 'f06-03' && !checkout)
    throw new Error('Controlled checkout must be explicitly selected.');
  if (
    task === 'f07' &&
    (!overlay ||
      !collection ||
      !review ||
      !terms ||
      checkout ||
      sandboxPayment ||
      reporting ||
      contributionReads ||
      operatorOAuth ||
      port !== 3310 ||
      origins.length !== 1 ||
      origins[0] !== 'http://127.0.0.1:4175')
  )
    throw new Error('OBS acceptance requires its isolated read-only overlay/review composition.');
  const apiOrigin = `http://${walkthrough ? 'localhost' : '127.0.0.1'}:${port}`;
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
  const sandboxConfiguration = sandboxPayment
    ? await readPaymentSandboxConfiguration(backend, sandboxPayment)
    : null;
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
  let supportFixture;
  let coinFixture;
  let paypalSandboxWebhook;
  const owned = (id) =>
    run('docker', ['inspect', '--format', '{{index .Config.Labels "darve.frontend.run"}}', id]) ===
    runId;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      const errors = [];
      if (paypalSandboxWebhook) {
        try {
          await paypalSandboxWebhook.close();
        } catch {
          errors.push('PayPal sandbox webhook cleanup requires its recorded custody file.');
        }
      }
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        server = null;
      }
      if (deps) {
        try {
          await supportFixture?.close();
          await coinFixture?.close();
          await deps.close();
        } catch {
          errors.push('API dependency cleanup failed.');
        }
        deps = null;
      }
      for (const id of containers.splice(0)) {
        try {
          if (!owned(id)) throw new Error('Container ownership could not be verified.');
          if (staffLifecycle) {
            const log = spawnSync('docker', ['logs', id], { encoding: 'utf8', windowsHide: true });
            // Diagnostics expose capability names only, never statements, arguments or provider data.
            const missing = new Set(
              (log.stdout + log.stderr).match(
                /permission denied for (?:table|view|function|sequence) [a-z_0-9]+/gi,
              ),
            );
            for (const capability of missing) console.error('Disposable lifecycle ' + capability);
          }
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
    const supportPolicy = support
      ? {
          ...(await import(pathToFileURL(path.join(backend, 'tests/fixtures/support.ts')).href))
            .supportPolicy,
          connectionSeconds: 120,
          conversationRetentionSeconds: 1,
        }
      : null;
    const receivingFixture = receiving
      ? (await import('./local-receiving-fixture.mjs')).localReceivingFixture(origins[0], apiOrigin)
      : null;
    const runtimeInput = {
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: port,
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      REDIS_URL: `redis://:${redisPassword}@127.0.0.1:${redisPort}`,
      CORS_ORIGINS: origins.join(','),
      RATE_LIMIT_MAX: 1000,
      ...receivingFixture?.environment,
      ...(support
        ? {
            SUPPORT_POLICY_JSON: JSON.stringify(supportPolicy),
            SUPPORT_PUBLIC_CURSOR_KEY_BASE64: randomBytes(32).toString('base64'),
          }
        : {}),
      ...(contributionReads ||
      checkout ||
      sandboxPayment ||
      handoff ||
      ['f07', 'f09-05', 'f09-07'].includes(task)
        ? { PUBLIC_CHALLENGE_BASE_URL: (qrPublicOrigin ?? origins[0]) + '/contribute/' }
        : {}),
      ...(review
        ? {
            CHALLENGE_TERMS_POLICY_JSON: JSON.stringify({
              version: 'synthetic-review-v1',
              currencies: {
                EUR: { minimumMinor: '1', maximumMinor: '9223372036854775807' },
                USD: { minimumMinor: '1', maximumMinor: '9223372036854775807' },
              },
              minimumFundingSeconds: 1,
              maximumFundingSeconds: 3600,
              ...(staffLifecycle
                ? {
                    extensionPolicy: {
                      version: 'support-extension-v1',
                      disclosure:
                        'An authorized deadline extension committed before funding closes changes the cutoff for all contributions, including payments already started. Payment eligibility uses verified provider timing against the effective deadline.',
                    },
                  }
                : {}),
            }),
          }
        : {}),
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
      ...(walkthrough
        ? { OAUTH_FRONTEND_ORIGIN: origins[0], OAUTH_BACKEND_ORIGIN: apiOrigin }
        : {}),
      ...(terms ? { TERMS_POLICY_FILE: termsFile } : {}),
      ...(overlay
        ? {
            OVERLAY_PRESENTATION_BASE_URL:
              origins[0] +
              (['f01-05', 'f07', 'f09-05', 'f09-07', 'f10-03', 'f10-04', 'f10-03-sandbox'].includes(
                task,
              )
                ? '/overlay/'
                : '/tests/fixtures/realtime.html/'),
            OVERLAY_GRANT_EPOCH: randomUUID(),
            OVERLAY_SSE_POLL_MS: 250,
          }
        : {}),
    };
    let config = readApiEnvironment(runtimeInput);
    if (fundedSandbox && sandboxConfiguration.provider === 'paypal') {
      const custodyDirectory = path.join(root, 'artifacts.local/f10-03-sandbox-paypal');
      mkdirSync(custodyDirectory, { recursive: true });
      const { startPayPalSandboxWebhook } = await import('./paypal-sandbox-webhook.mjs');
      paypalSandboxWebhook = await startPayPalSandboxWebhook({
        receiving: sandboxConfiguration.receiving,
        sourceRoot: sandboxPayment.sourceRoot,
        custodyFile: path.join(custodyDirectory, 'webhook-custody.json'),
      });
      config.paypalCheckout = sandboxConfiguration.checkout;
      config.paypalWebhook = {
        receiving: sandboxConfiguration.receiving,
        webhookId: paypalSandboxWebhook.id,
      };
    }
    const sellerConfig = seller
      ? await (
          await import('./payment-sandbox-config.mjs')
        ).readPaymentSandboxConfiguration(backend, sellerObservation)
      : null;
    if (sellerConfig?.provider === 'stripe')
      config.stripeReceiving = {
        ...sellerConfig.receiving,
        returnUrl: origins[0] + '/account/payments',
        refreshUrl: origins[0] + '/account/payments',
      };
    if (sellerConfig?.provider === 'paypal') {
      config.paypalReceiving = {
        ...sellerConfig.receiving,
        returnUrl: origins[0] + '/account/payments',
      };
      config.credentialCipher = sellerConfig.cipher;
    }
    const logger = createLogger('silent');
    deps = createDependencies(config, logger);
    const ready = await deps.checkReadiness();
    if (ready.status !== 'ready') throw new Error('Isolated runtime dependencies are unavailable.');
    supportFixture = support
      ? await (
          await import('./local-support-fixture.mjs')
        ).createLocalSupportFixture(backend, databaseUrl, deps.database, supportPolicy)
      : null;
    const sellerFixture = sellerConfig
      ? await (
          await import('./local-seller-observation.mjs')
        ).createSellerObservation(backend, deps.database, config, sellerConfig)
      : null;
    let receivingReadiness;
    if (handoff) {
      const { createApiStripeReceiving } = await import(
        pathToFileURL(path.join(backend, 'apps/api/dist/composition/stripe-receiving.js')).href
      );
      const { createApiPayPalReceiving } = await import(
        pathToFileURL(path.join(backend, 'apps/api/dist/composition/paypal-receiving.js')).href
      );
      const { combineFundingReadiness } = await import(
        pathToFileURL(path.join(backend, 'packages/domain/dist/index.js')).href
      );
      receivingReadiness = combineFundingReadiness([
        createApiStripeReceiving(
          deps.database,
          config,
          receivingFixture.dependencies.stripeReceivingProvider,
        ).readiness,
        createApiPayPalReceiving(
          deps.database,
          config,
          receivingFixture.dependencies.paypalReceivingProvider,
        ).readiness,
      ]);
    }
    const checkoutFixture = checkout
      ? await (
          await import('./local-checkout-fixture.mjs')
        ).createLocalCheckoutFixture(backend, deps.database, config)
      : null;
    const sandboxFixture = sandboxConfiguration
      ? await (
          await import('./payment-sandbox-fixture.mjs')
        ).createPaymentSandboxFixture(backend, deps.database, config, sandboxConfiguration)
      : null;
    const paymentReadiness = (checkoutFixture ?? sandboxFixture)?.dependencies.checkoutExposure
      .readiness;
    const collectionFixture = collection
      ? await (
          await import('./local-collection-fixture.mjs')
        ).createLocalCollectionFixture(backend, deps.database, config, {
          coinActivity: ['f09-03', 'f09-05', 'f09-07'].includes(task),
          continuedLifecycle: staffLifecycle,
          allProviderIdeas: task === 'f10-02' || fundedLifecycle,
          receivingReadiness:
            fundedLifecycle || fundedSandbox ? paymentReadiness : receivingReadiness,
        })
      : null;
    coinFixture = coins
      ? await (
          await import('./local-coin-fixture.mjs')
        ).createLocalCoinFixture(backend, databaseUrl, deps.database, {
          linuxJournal: [
            'f09-g01',
            'f09-03',
            'f09-04',
            'f09-05',
            'f09-06',
            'f09-07',
            'f10-04',
          ].includes(task),
          task,
          runId,
          staffAuthority: ['f09-06', 'f09-07', 'f10-04'].includes(task)
            ? supportFixture?.coinAuthority
            : null,
        })
      : null;
    if (coinFixture) config = readApiEnvironment({ ...runtimeInput, ...coinFixture.environment });
    const reviewFixture = review
      ? await (
          await import('./local-review-fixture.mjs')
        ).createLocalReviewFixture(backend, deps.database)
      : null;
    const walkthroughIdentity = walkthrough
      ? (await import('./local-walkthrough-identity.mjs')).walkthroughTwitch
      : null;
    const reportingFixture = reporting
      ? await (
          await import('./local-reporting-fixture.mjs')
        ).createLocalReportingFixture(backend, deps.database)
      : null;
    const contributionFixture = contributionReads
      ? await (
          await import('./local-contribution-fixture.mjs')
        ).createLocalContributionFixture(backend, deps.database)
      : null;
    const listen = () =>
      new Promise((resolve, reject) => {
        const listener = createApp(config, logger, {
          ...deps,
          ...collectionFixture?.dependencies,
          ...contributionFixture?.dependencies,
          ...checkoutFixture?.dependencies,
          ...sandboxFixture?.dependencies,
          ...receivingFixture?.dependencies,
          ...sellerFixture?.dependencies,
          ...(walkthroughIdentity
            ? {
                oauthProviders: {
                  ...collectionFixture.dependencies.oauthProviders,
                  TWITCH: walkthroughIdentity,
                },
              }
            : {}),
          ...(receivingReadiness
            ? {
                checkoutExposure: {
                  providers: ['stripe', 'paypal'],
                  readiness: receivingReadiness,
                },
              }
            : {}),
          ...(supportFixture ? { database: supportFixture.publicDatabase } : {}),
          ...(coinFixture ? { database: coinFixture.publicDatabase } : {}),
        }).listen(port, '127.0.0.1', () => resolve(listener));
        listener.once('error', reject);
      });
    server = await listen();
    const migrationRows = await deps.database
      .$queryRaw`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    const state = {
      runId,
      apiOrigin,
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
      paypalSandboxIngress: paypalSandboxWebhook?.verifiedIngress,
      receivingCounts: receivingFixture?.counts,
      sellerFixture,
      receivingHandoffAudit: handoff
        ? async () => ({
            attempts: await deps.database.paymentCheckoutAttempt.count(),
            payments: await deps.database.financialPayment.count(),
          })
        : undefined,
      collectionFixture,
      async prepareTemplateOverlay(secret) {
        if (!['f09-05', 'f09-07'].includes(task) || !collectionFixture || !reviewFixture)
          throw Error('Template observation requires its exact isolated composition.');
        const load = (file) => import(pathToFileURL(path.join(backend, file)).href);
        const db = await load('packages/database/dist/index.js'),
          domain = await load('packages/domain/dist/index.js');
        const { createIdentityAccessServices } = await load(
          'apps/api/dist/composition/identity-access.js',
        );
        const identity = createIdentityAccessServices(
          config,
          deps.database,
          collectionFixture.dependencies.oauthProviders,
        );
        const actor = await identity.session.access(secret, true, sessionCsrfProof(secret));
        const roundId = await collectionFixture.collectForCoins(
          secret,
          ['Draw a cat'],
          ['synthetic-template-viewer'],
        );
        const published = await reviewFixture.publish(actor.userId, roundId),
          item = published.items[0];
        const acceptance = domain.createChallengeAcceptanceService({
          repository: db.createChallengeAcceptanceRepository(deps.database),
          discovery: collectionFixture.dependencies.streamDiscovery,
          funding: collectionFixture.dependencies.fundingReadiness,
          policy: config.challengeTermsPolicy,
          terms: config.termsPolicy,
        });
        const result = await acceptance.accept(
          actor,
          roundId,
          item.resultId + '.' + item.group.id,
          randomUUID(),
          {
            expectedVersion: item.version,
            analysisRunId: item.runId,
            resultVersion: item.resultId,
            snapshotVersion: item.snapshotVersion,
            goal: { amountMinor: '100000', currency: 'EUR' },
            fundingDurationSeconds: 1800,
          },
        );
        const link = await deps.database.challengePublicLink.findUniqueOrThrow({
          where: { challengeId: result.challenge.id },
        });
        return {
          roundId,
          challengeId: result.challenge.id,
          publicUrl: config.PUBLIC_CHALLENGE_BASE_URL + link.publicId,
        };
      },
      async diagnoseTemplateBinding(secret, id, command) {
        if (!['f09-05', 'f09-07'].includes(task)) throw Error('Wrong diagnostic scope');
        const db = await import(
          pathToFileURL(path.join(backend, 'packages/database/dist/index.js')).href
        );
        const identity = await import(
          pathToFileURL(path.join(backend, 'apps/api/dist/composition/identity-access.js')).href
        );
        const actor = await identity
          .createIdentityAccessServices(
            config,
            deps.database,
            collectionFixture.dependencies.oauthProviders,
          )
          .session.access(secret, true, sessionCsrfProof(secret));
        return db
          .createOverlayRepository(coinFixture.publicDatabase)
          .select(
            actor.userId,
            { secretHash: actor.secretHash, csrfHash: actor.csrfHash },
            id,
            command,
          )
          .catch((error) => {
            const missing = String(error.meta?.message ?? error.message).match(
              /permission denied for table ([a-z_]+)/,
            );
            if (missing)
              throw Error('Fixture missing table privilege: ' + missing[1].replaceAll('_', ' '));
            throw error;
          });
      },
      reviewFixture,
      reportingFixture,
      contributionFixture,
      checkoutFixture,
      sandboxFixture,
      supportFixture,
      coinFixture,
      createStaffWorkbench: async () => {
        if (
          !['f08-05', 'f08-06', 'f08-07', 'f08-08', 'f09-06', 'f09-07', 'f10-04'].includes(task) ||
          !supportFixture
        )
          throw new Error('Staff workbench requires F08-05 disposable composition.');
        return supportFixture.workbench(deps.redis, {
          administration: ['f08-06', 'f08-07', 'f08-08', 'f09-06', 'f09-07', 'f10-04'].includes(
            task,
          ),
          coinWorkbench: ['f09-06', 'f09-07', 'f10-04'].includes(task)
            ? coinFixture?.staffWorkbench
            : null,
          recovery: ['f08-07', 'f08-08', 'f10-04'].includes(task),
        });
      },
      seedStaffInspection: async (creator, options = {}) => {
        if (
          !['f08-06', 'f08-07', 'f08-08'].includes(task) ||
          !supportFixture ||
          (!['f08-07', 'f08-08'].includes(task) && Object.keys(options).length)
        )
          throw new Error(
            'Staff inspection seed requires the exact F08-06 disposable composition.',
          );
        return (await import('./local-staff-admin-seed.mjs')).seedStaffInspection({
          backend,
          deps,
          logger,
          runtimeInput,
          creator,
          ...options,
        });
      },
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
      async seedSession({
        expiresInMs = 60_000,
        coinOwner = false,
        displayName = 'Synthetic local creator',
      } = {}) {
        if (
          coinOwner &&
          (!['f09-g01', 'f09-03', 'f09-04', 'f09-05', 'f09-06', 'f09-07', 'f10-04'].includes(
            task,
          ) ||
            !coinFixture?.durability)
        )
          throw new Error('Existing coin owner requires the exact journal acceptance fixture.');
        const secret = randomBytes(32).toString('base64url');
        const user = coinOwner
          ? await deps.database.darveUser.findUniqueOrThrow({
              where: { id: coinFixture.durability.ownerId },
            })
          : await deps.database.darveUser.create({
              data: {
                ...(sandboxConfiguration || sellerConfig
                  ? { id: (sandboxConfiguration ?? sellerConfig).ownerId }
                  : {}),
                displayName,
              },
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
