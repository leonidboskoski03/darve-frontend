import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { inspect as inspectValue } from 'node:util';
import {
  frontendRoot,
  selectConnectedCredentials,
  newConnectedState,
  assertConnectedState,
  assertOwned,
  assertDataDirectory,
  isPrivateProductPath,
  connectedServerEnvironment,
  systemChildEnvironment,
} from './connected-product-config.mjs';
import { connectedStatus } from './connected-product.mjs';
import { destroyAcceptanceStorage } from './connected-product-storage.mjs';

test('connected credentials select only complete server client pairs and disclose no rejected value', () => {
  assert.deepEqual(
    selectConnectedCredentials({
      TWITCH_CLIENT_ID: 'id',
      TWITCH_CLIENT_SECRET: 'private',
      DATABASE_URL: 'foreign',
      VITE_SECRET: 'forbidden',
    }),
    { TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'private' },
  );
  assert.deepEqual(selectConnectedCredentials({}), {});
  assert.throws(
    () => selectConnectedCredentials({ GOOGLE_CLIENT_ID: 'do-not-print-this' }),
    (error) => !inspectValue(error).includes('do-not-print-this'),
  );
});
test('persistent local identity and keys survive serialization, but incompatible source or invalid identities fail closed', () => {
  const state = newConnectedState('source'),
    restored = JSON.parse(JSON.stringify(state));
  assert.doesNotThrow(() => assertConnectedState(restored, 'source'));
  assert.equal(restored.cipherKey, state.cipherKey);
  assert.equal(restored.overlayEpoch, state.overlayEpoch);
  assert.notEqual(newConnectedState('source').cipherKey, state.cipherKey);
  for (const change of [
    { source: 'old' },
    { profileId: '-'.repeat(36) },
    { cipherKey: 'bad' },
    { postgresPassword: 'bad' },
  ])
    assert.throws(() => assertConnectedState({ ...state, ...change }, 'source'), /incompatible/);
});
test('local state paths cannot escape the ignored workspace namespace', () => {
  assert.equal(
    assertDataDirectory(path.join(frontendRoot, 'artifacts.local/connected-product')),
    path.join(frontendRoot, 'artifacts.local/connected-product'),
  );
  for (const target of [
    frontendRoot,
    path.join(frontendRoot, 'artifacts.local/../src'),
    path.join(frontendRoot, '../darve-backend'),
  ])
    assert.throws(() => assertDataDirectory(target), /ignored/);
});
test('every Docker operation requires all three exact resource ownership labels', () => {
  const labels = {
    'darve.frontend.task': 'f02-04',
    'darve.frontend.profile': 'owner',
    'darve.frontend.role': 'postgres',
  };
  assert.doesNotThrow(() => assertOwned({ Labels: labels }, 'owner', 'postgres'));
  for (const key of Object.keys(labels))
    assert.throws(
      () =>
        assertOwned({ Config: { Labels: { ...labels, [key]: 'foreign' } } }, 'owner', 'postgres'),
      /ownership/,
    );
});
test('connected frontend denies private files and fixture/control paths, including encoded and absolute paths', () => {
  for (const route of [
    '/artifacts.local/connected-product/private.json',
    '/@fs/C:/repo/artifacts.local/private.json',
    '/%61rtifacts.local/private.json',
    '/tools/connected-product.mjs',
    '/tests/fixtures/session.html',
    '/.env',
    '/.env.local',
    '/test-results/file',
    '/x\\artifacts.local\\private.json',
    '/%ZZ',
  ])
    assert.equal(isPrivateProductPath(route), true, route);
  for (const route of [
    '/',
    '/dashboard',
    '/collection/id',
    '/src/app/main.tsx',
    '/@vite/client',
    '/fonts/inter.woff2',
  ])
    assert.equal(isPrivateProductPath(route), false, route);
});
test('server environment fixes one loopback profile without inheriting financial/worker/staff flags or frontend secrets', () => {
  const env = connectedServerEnvironment(
    '/backend',
    newConnectedState('source'),
    { postgres: 40001, redis: 40002 },
    {
      STRIPE_SECRET_KEY: 'not-used',
      STAFF_ENABLED: 'true',
      TWITCH_CLIENT_ID: 'id',
      TWITCH_CLIENT_SECRET: 'private',
    },
  );
  assert.equal(env.CORS_ORIGINS, 'http://localhost:5174');
  assert.equal(env.OAUTH_BACKEND_ORIGIN, 'http://localhost:3000');
  assert.equal(env.STRIPE_SECRET_KEY, undefined);
  assert.equal(env.STAFF_ENABLED, undefined);
  assert.equal(env.VITE_PUBLIC_API_ORIGIN, undefined);
  assert.equal(env.OAUTH_RETURN_PATHS, '/,/integrations');
  assert.equal(systemChildEnvironment().NODE_OPTIONS, undefined);
});
test('acceptance finalizer cannot destroy a normal persistent product profile', () => {
  assert.throws(() => destroyAcceptanceStorage({ purpose: 'product' }), /cannot be removed/);
});
test('public status does not spread private or unknown fields from local metadata', () => {
  const root = path.join(frontendRoot, 'artifacts.local/f02-04');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, 'status-'));
  try {
    writeFileSync(
      path.join(dir, 'runtime.json'),
      JSON.stringify({
        phase: 'stopped',
        pid: 0,
        postgresPassword: 'do-not-print',
        cipherKey: 'do-not-print',
      }),
    );
    const status = connectedStatus(dir);
    assert.equal(status.ownerAlive, false);
    assert.equal(JSON.stringify(status).includes('do-not-print'), false);
  } finally {
    unlinkSync(path.join(dir, 'runtime.json'));
    rmdirSync(dir);
  }
});
