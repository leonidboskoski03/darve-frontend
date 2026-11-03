import { createServer } from 'node:http';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createLocalCollectionFixture } from './local-collection-fixture.mjs';
import { createLocalReviewFixture } from './local-review-fixture.mjs';
/** Privileged Node-only setup for the disposable admin test. No seed endpoint enters the product/runtime API. */
export async function seedStaffInspection({
  backend,
  deps,
  logger,
  runtimeInput,
  creator,
  disclosed = false,
  reviewInBrowser,
  evidenceDirectory = 'artifacts.local/f08-06',
  readProjection = false,
}) {
  const load = (file) => import(pathToFileURL(join(backend, file)).href);
  const { readApiEnvironment } = await load('apps/api/dist/config/environment.js');
  const { createApp } = await load('apps/api/dist/app.js');
  mkdirSync(evidenceDirectory, { recursive: true });
  const termsFile = resolve(evidenceDirectory, 'inspection-terms.json'),
    content = 'Synthetic local staff inspection setup terms. Not a commercial policy.';
  writeFileSync(
    termsFile,
    JSON.stringify({
      documentId: 'staff-inspection-synthetic',
      version: 'synthetic-v1',
      classification: 'development',
      contentHash: createHash('sha256').update(content).digest('hex'),
      content,
    }),
  );
  const config = readApiEnvironment({
    ...runtimeInput,
    PORT: 3311,
    TERMS_POLICY_FILE: termsFile,
    CREDENTIAL_ENCRYPTION_KEY_ID: 'staff-inspection-fixture',
    CREDENTIAL_ENCRYPTION_KEY_BASE64: randomBytes(32).toString('base64'),
    TWITCH_CLIENT_ID: 'a'.repeat(20),
    TWITCH_CLIENT_SECRET: 'a'.repeat(30),
    GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'a'.repeat(30),
    KICK_CLIENT_ID: 'a'.repeat(26),
    KICK_CLIENT_SECRET: 'a'.repeat(30),
    CHALLENGE_TERMS_POLICY_JSON: JSON.stringify({
      version: 'synthetic-staff-inspection-v1',
      currencies: { EUR: { minimumMinor: '1', maximumMinor: '9223372036854775807' } },
      minimumFundingSeconds: 1,
      maximumFundingSeconds: 3600,
      ...(disclosed
        ? {
            extensionPolicy: {
              version: 'support-extension-v1',
              disclosure:
                'An authorized deadline extension committed before funding closes changes the cutoff for all contributions, including payments already started. Payment eligibility uses verified provider timing against the effective deadline.',
            },
          }
        : {}),
    }),
  });
  const collection = await createLocalCollectionFixture(backend, deps.database, config),
    review = await createLocalReviewFixture(backend, deps.database);
  collection.capacity('available');
  const stream = await collection.seed(creator.userId);
  const { RedisStore } = createRequire(join(backend, 'package.json'))('rate-limit-redis');
  const rateLimitStore = new RedisStore({
    prefix: 'darve:f08-06-setup:',
    sendCommand: (...args) => {
      const [command, ...parameters] = args;
      return deps.redis.call(command, ...parameters);
    },
  });
  const server = createServer(
    createApp(config, logger, { ...deps, ...collection.dependencies, rateLimitStore }),
  );
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  let csrf;
  const request = async (path, method = 'GET', body = undefined, status = 200) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: 'http://127.0.0.1:4175',
        Cookie: 'darve_session=' + creator.secret,
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
    });
    const value = await response.json();
    if (response.status !== status) {
      const error = new Error('Synthetic inspection setup unavailable');
      error.setupOperation = method + ' ' + path.replace(/[0-9a-f-]{36}/gi, ':id');
      error.setupStatus = response.status;
      error.setupCode = /^[A-Z0-9_]{1,80}$/.test(value.error?.code ?? '') ? value.error.code : null;
      throw error;
    }
    return value;
  };
  try {
    csrf = (await request('/api/session')).csrfToken;
    const terms = (await request('/api/terms/current')).data;
    await request('/api/terms/acceptance', 'POST', {
      documentId: terms.documentId,
      version: terms.version,
      contentHash: terms.contentHash,
      accepted: true,
    });
    const started = (
      await request(
        '/api/rounds',
        'POST',
        { ...stream, collectionDurationSeconds: 60, announcementPinMode: 'off' },
        202,
      )
    ).data;
    await collection.recover();
    const active = (await request('/api/rounds/' + started.id)).data;
    await collection.admitIdeas(creator.userId, started.id);
    await request(
      '/api/rounds/' + started.id + '/collection/stop',
      'POST',
      { expectedVersion: active.version },
      202,
    );
    await review.publish(creator.userId, started.id);
    const suggestions = (await request('/api/rounds/' + started.id + '/suggestions')).data,
      item = suggestions.items[0];
    const accepted = reviewInBrowser
      ? await reviewInBrowser({ base, roundId: started.id, item })
      : (
          await request(
            '/api/rounds/' + started.id + '/suggestions/' + item.id + '/accept',
            'POST',
            {
              expectedVersion: item.version,
              analysisRunId: item.analysisRunId,
              resultVersion: suggestions.resultVersion,
              snapshotVersion: item.snapshotVersion,
              goal: { amountMinor: '9007199254740993', currency: 'EUR' },
              fundingDurationSeconds: 600,
              ...(disclosed ? { extensionPolicyVersion: 'support-extension-v1' } : {}),
            },
            201,
          )
        ).data;
    if (readProjection) await request('/api/challenges/' + accepted.id);
    return {
      id: accepted.id,
      roundId: started.id,
      redact: () => review.restrict(started.id),
      financialEvidence: async () => ({
        funding: await deps.database.challengeFunding.findUnique({
          where: { challengeId: accepted.id },
        }),
        events: await deps.database.challengeFundingEvent.count({
          where: { challengeId: accepted.id },
        }),
      }),
    };
  } finally {
    await new Promise((done) => {
      server.close(done);
      server.closeAllConnections();
    });
  }
}
