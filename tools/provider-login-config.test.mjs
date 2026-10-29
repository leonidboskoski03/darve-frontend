import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertProviderLoginRuntime,
  providerLoginEnvironment,
  isProviderLoginStopRequest,
} from './provider-login-config.mjs';

const credentials = Object.fromEntries(
  ['TWITCH', 'GOOGLE', 'KICK'].flatMap((provider) =>
    ['ID', 'SECRET'].map((kind) => [`${provider}_CLIENT_${kind}`, 'synthetic-private-value']),
  ),
);
test('operator mode selects only provider credentials and uses a new disposable key', () => {
  const a = providerLoginEnvironment({
    ...credentials,
    DATABASE_URL: 'must-not-inherit',
    REDIS_URL: 'must-not-inherit',
    LOG_LEVEL: 'debug',
    CREDENTIAL_ENCRYPTION_KEY_BASE64: 'must-not-inherit',
    TERMS_POLICY_FILE: 'must-not-inherit',
  });
  assert.equal(a.DATABASE_URL, undefined);
  assert.equal(a.REDIS_URL, undefined);
  assert.equal(a.LOG_LEVEL, undefined);
  assert.equal(a.TERMS_POLICY_FILE, undefined);
  assert.equal(Buffer.from(a.CREDENTIAL_ENCRYPTION_KEY_BASE64, 'base64').length, 32);
  assert.notEqual(
    a.CREDENTIAL_ENCRYPTION_KEY_BASE64,
    providerLoginEnvironment(credentials).CREDENTIAL_ENCRYPTION_KEY_BASE64,
  );
  assert.equal(a.OAUTH_BACKEND_ORIGIN, 'http://localhost:3000');
  assert.equal(a.OAUTH_FRONTEND_ORIGIN, 'http://localhost:5174');
});
test('all three complete configurations are required without exposing supplied values', () => {
  for (const field of Object.keys(credentials)) {
    const partial = { ...credentials, [field]: '' };
    assert.throws(() => providerLoginEnvironment(partial), /All three provider/);
  }
});
test('ordinary disposable callers keep providers disabled and cannot claim callback port', () => {
  assert.deepEqual(
    assertProviderLoginRuntime({ task: 'f03', port: 3310, origins: ['http://127.0.0.1:4175'] }),
    {},
  );
  assert.throws(() =>
    assertProviderLoginRuntime({ task: 'f03', port: 3000, origins: ['http://localhost:5174'] }),
  );
  assert.throws(() =>
    assertProviderLoginRuntime({
      task: 'f03-live',
      port: 3000,
      origins: ['http://localhost:5174'],
    }),
  );
});
test('operator credentials require exactly the reviewed task, API port and frontend origin', () => {
  const valid = {
    task: 'f03-live',
    port: 3000,
    origins: ['http://localhost:5174'],
    operatorOAuth: credentials,
  };
  assert.equal(assertProviderLoginRuntime(valid).TWITCH_CLIENT_ID, credentials.TWITCH_CLIENT_ID);
  for (const override of [
    { task: 'f03' },
    { port: 3310 },
    { origins: ['http://127.0.0.1:5174'] },
    { origins: ['http://localhost:5174', 'https://foreign.invalid'] },
  ])
    assert.throws(() => assertProviderLoginRuntime({ ...valid, ...override }));
});
test('an operator stop request is bound to the exact current run', () => {
  const runId = '11111111-1111-4111-8111-111111111111';
  assert.equal(isProviderLoginStopRequest({ action: 'stop', runId }, runId), true);
  assert.equal(
    isProviderLoginStopRequest({ action: 'stop', runId }, '22222222-2222-4222-8222-222222222222'),
    false,
  );
  assert.equal(isProviderLoginStopRequest({ action: 'start', runId }, runId), false);
  assert.equal(isProviderLoginStopRequest(null, runId), false);
  assert.equal(isProviderLoginStopRequest({ action: 'stop', runId: 'invalid' }, 'invalid'), false);
});
