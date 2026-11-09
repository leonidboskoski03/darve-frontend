import assert from 'node:assert/strict';
import test from 'node:test';
import { startLocalApi } from './local-api.mjs';
import { assertLifecycleComposition } from './local-lifecycle-config.mjs';

test('F06-06 isolates controlled readiness from existing seller verification and checkout', async () => {
  const base = { backend: 'must-not-be-read', origins: ['http://127.0.0.1:4175'], terms: true };
  const controlled = {
    ...base,
    port: 3311,
    origins: ['http://127.0.0.1:4177'],
    task: 'f06-06',
    collection: true,
    review: true,
    receiving: true,
  };
  const seller = {
    ...base,
    task: 'f06-06-seller',
    sellerObservation: {
      approval: 'F06-06',
      provider: 'paypal',
      sourceRoot: 'must-not-be-read',
    },
  };
  for (const change of [
    { checkout: true },
    { overlay: true },
    { operatorOAuth: {} },
    { collection: false },
    { sellerObservation: {} },
  ])
    await assert.rejects(startLocalApi({ ...controlled, ...change }), /exact disposable F06-06/);
  for (const change of [
    { checkout: true },
    { receiving: true },
    { collection: true },
    { sellerObservation: undefined },
    { port: 3000 },
  ])
    await assert.rejects(startLocalApi({ ...seller, ...change }), /exact disposable F06-06/);
  const walkthrough = {
    ...controlled,
    task: 'f01-05',
    origins: ['http://localhost:4177'],
    overlay: true,
  };
  for (const change of [
    { overlay: false },
    { checkout: true },
    { operatorOAuth: {} },
    { sellerObservation: seller.sellerObservation },
    { sandboxPayment: {} },
    { port: 3000 },
  ])
    await assert.rejects(startLocalApi({ ...walkthrough, ...change }), /F01-05 composition/);
});

test('receiving fixture rejects unreviewed origins, ports and combined capabilities before startup', async () => {
  const options = {
    backend: 'not-used',
    task: 'f03-04',
    origins: ['http://127.0.0.1:4175'],
    terms: true,
    receiving: true,
  };
  for (const override of [
    { task: 'f03' },
    { terms: false },
    { port: 3000 },
    { origins: ['https://foreign.invalid'] },
    { operatorOAuth: {} },
    { sandboxPayment: {} },
    { checkout: true },
    { collection: true },
    { support: true },
  ])
    await assert.rejects(startLocalApi({ ...options, ...override }), /Receiving qualification/);
});

const lifecycle = {
  backend: 'not-used',
  task: 'f10-02',
  port: 3310,
  origins: ['http://127.0.0.1:4175'],
  collection: true,
  review: true,
  reporting: true,
  terms: true,
};
test('creator lifecycle admits only its explicit local provider-free composition', () => {
  assert.doesNotThrow(() => assertLifecycleComposition(lifecycle));
  assert.throws(
    () => assertLifecycleComposition({ ...lifecycle, task: 'f09-07' }),
    /Creator lifecycle/,
  );
});
test('creator lifecycle requires all coupled features and the isolated source/origin identity', async () => {
  for (const change of [
    { collection: false },
    { review: false },
    { reporting: false },
    { terms: false },
    { collection: 1 },
    { port: 3000 },
    { port: 3311 },
    { origins: [] },
    { origins: ['http://localhost:4175'] },
    { origins: ['https://example.test'] },
    { origins: [...lifecycle.origins, 'http://127.0.0.1:5173'] },
  ])
    await assert.rejects(startLocalApi({ ...lifecycle, ...change }), /Creator lifecycle/);
});
test('creator lifecycle refuses payment, external credentials, OBS, staff and coin extensions before runtime access', async () => {
  for (const change of [
    { checkout: true },
    { sandboxPayment: {} },
    { sandboxPayment: null },
    { contributionReads: true },
    { operatorOAuth: {} },
    { operatorOAuth: null },
    { overlay: true },
    { qrPublicOrigin: 'https://synthetic.trycloudflare.com' },
    { support: true },
    { coins: true },
  ])
    await assert.rejects(startLocalApi({ ...lifecycle, ...change }), /Creator lifecycle/);
});

test('funded lifecycle requires controlled checkout and OBS without direct reporting funding or credentials', async () => {
  const funded = { ...lifecycle, task: 'f10-03', reporting: false, overlay: true, checkout: true };
  assert.doesNotThrow(() => assertLifecycleComposition(funded));
  for (const change of [
    { collection: false },
    { review: false },
    { terms: false },
    { reporting: true },
    { checkout: false },
    { overlay: false },
    { contributionReads: true },
    { sandboxPayment: {} },
    { operatorOAuth: {} },
    { qrPublicOrigin: 'https://synthetic.invalid' },
    { support: true },
    { coins: true },
    { port: 3000 },
    { origins: ['http://localhost:4175'] },
  ])
    await assert.rejects(startLocalApi({ ...funded, ...change }), /Creator lifecycle/);
});

test('staff lifecycle admits its controlled capability set and rejects external or partial composition before runtime access', async () => {
  const staff = {
    ...lifecycle,
    task: 'f10-04',
    reporting: false,
    overlay: true,
    checkout: true,
    support: true,
    coins: true,
  };
  assert.doesNotThrow(() => assertLifecycleComposition(staff));
  for (const change of [
    ...['collection', 'review', 'terms', 'overlay', 'checkout', 'support', 'coins'].map((key) => ({
      [key]: false,
    })),
    { support: 1 },
    { coins: 1 },
    { reporting: true },
    { contributionReads: true },
    { sandboxPayment: {} },
    { sandboxPayment: null },
    { operatorOAuth: {} },
    { qrPublicOrigin: 'https://external.example.test' },
    { port: 3000 },
    { origins: ['http://localhost:4175'] },
  ])
    await assert.rejects(startLocalApi({ ...staff, ...change }), /Creator lifecycle/);
});

for (const task of ['f08-04', 'f08-05', 'f08-06', 'f08-07', 'f08-08'])
  test(
    task + ' support qualification cannot enable unrelated controlled or external services',
    async () => {
      const base = {
        backend: 'not-used',
        task,
        support: true,
        port: 3310,
        origins: ['http://127.0.0.1:4175'],
      };
      for (const change of [
        { task: 'f03' },
        { support: false },
        { collection: true },
        { review: true },
        { overlay: true },
        { reporting: true },
        { terms: true },
        { checkout: true },
        { sandboxPayment: {} },
        { operatorOAuth: {} },
        { port: 3000 },
        { origins: ['https://example.test'] },
      ])
        await assert.rejects(startLocalApi({ ...base, ...change }), /Creator support acceptance/);
    },
  );

test('public QR base changes are scoped to the explicit temporary F07 HTTPS test', async () => {
  for (const options of [
    { task: 'f03', qrPublicOrigin: 'https://synthetic.trycloudflare.com' },
    { task: 'f07', qrPublicOrigin: 'http://local.example.test' },
    { task: 'f07', qrPublicOrigin: 'https://unreviewed.example.test' },
    { task: 'f07', qrPublicOrigin: 'https://synthetic.trycloudflare.com/path' },
  ])
    await assert.rejects(startLocalApi({ backend: 'not-used', ...options }), /Mobile QR origin/);
});

test('OBS qualification cannot enable payments or escape its reviewed disposable composition', async () => {
  const base = {
    backend: 'not-used',
    task: 'f07',
    port: 3310,
    origins: ['http://127.0.0.1:4175'],
    overlay: true,
    collection: true,
    review: true,
    terms: true,
  };
  for (const change of [
    { overlay: false },
    { terms: false },
    { origins: ['https://public.example.test'] },
    { port: 3311 },
    { collection: false, review: false },
  ])
    await assert.rejects(startLocalApi({ ...base, ...change }), /OBS acceptance/);
  await assert.rejects(startLocalApi({ ...base, checkout: true }), /Controlled checkout/);
});

test('sandbox payments fail closed before configuration/storage unless separately approved and isolated', async () => {
  const permitted = {
    backend: 'not-used',
    task: 'f06-04',
    port: 3310,
    origins: ['http://127.0.0.1:4175'],
    collection: true,
    review: true,
    sandboxPayment: { provider: 'stripe', approval: 'F06-04', sourceRoot: 'not-used' },
  };
  for (const override of [
    { task: 'f06-03' },
    { sandboxPayment: undefined },
    { port: 3000 },
    { checkout: true },
    { contributionReads: true },
    { reporting: true },
    { operatorOAuth: {} },
    { review: false },
    { origins: ['https://public.example.test'] },
    { sandboxPayment: { ...permitted.sandboxPayment, approval: 'yes' } },
    { sandboxPayment: { ...permitted.sandboxPayment, provider: 'live' } },
  ])
    await assert.rejects(startLocalApi({ ...permitted, ...override }), /Payment sandbox requires/);
});

test('F10-03 sandbox requires separate approval and its local overlay composition', async () => {
  const sandbox = { provider: 'paypal', approval: 'F10-03', sourceRoot: 'not-used' };
  const permitted = {
    backend: 'not-used',
    task: 'f10-03-sandbox',
    origins: ['http://127.0.0.1:4175'],
    port: 3310,
    collection: true,
    review: true,
    terms: true,
    overlay: true,
    sandboxPayment: sandbox,
  };
  for (const override of [
    { overlay: false },
    { terms: false },
    { checkout: true },
    { reporting: true },
    { sandboxPayment: { ...sandbox, approval: 'F06-04' } },
    { sandboxPayment: { ...sandbox, provider: 'live' } },
  ])
    await assert.rejects(startLocalApi({ ...permitted, ...override }), /Payment sandbox requires/);
});

test('controlled checkout requires explicit isolated selection before Docker or source access', async () => {
  for (const options of [
    { task: 'f06', collection: true, review: true, checkout: true },
    { task: 'f06-03', checkout: true },
    { task: 'f06-03', collection: true, review: true },
    { task: 'f06-03', collection: true, review: true, checkout: true, operatorOAuth: {} },
  ])
    await assert.rejects(
      startLocalApi({ backend: 'not-used', ...options }),
      /Controlled checkout|Provider login requires/,
    );
});
test('controlled collection ports cannot be enabled by an ordinary creator fixture task', async () => {
  await assert.rejects(
    startLocalApi({ backend: 'not-used', task: 'f03', collection: true }),
    /explicit disposable task/,
  );
});
test('collection task cannot combine controlled facts with real-provider operator credentials', async () => {
  await assert.rejects(
    startLocalApi({
      backend: 'not-used',
      task: 'f04-02',
      collection: true,
      operatorOAuth: {},
      port: 3000,
      origins: ['http://localhost:5174'],
    }),
    /Provider login requires/,
  );
});

test('review facts require their own explicit collection task before runtime access', async () => {
  await assert.rejects(
    startLocalApi({ backend: 'not-used', task: 'f04-02', collection: true, review: true }),
    /Controlled review requires/,
  );
  await assert.rejects(
    startLocalApi({ backend: 'not-used', task: 'f04-03', review: true }),
    /Controlled review requires/,
  );
});

test('reporting financial facts require their own explicit disposable review composition', async () => {
  await assert.rejects(
    startLocalApi({
      backend: 'not-used',
      task: 'f04-03',
      collection: true,
      review: true,
      reporting: true,
    }),
    /Controlled reporting requires/,
  );
  await assert.rejects(
    startLocalApi({ backend: 'not-used', task: 'f05', reporting: true }),
    /Controlled reporting requires/,
  );
});
test('read-only receipt facts require the exact F06 composition without enabling ordinary payment creation', async () => {
  await assert.rejects(
    startLocalApi({
      backend: 'not-used',
      task: 'f05',
      collection: true,
      review: true,
      contributionReads: true,
    }),
    /Controlled receipt reads require/,
  );
  await assert.rejects(
    startLocalApi({ backend: 'not-used', task: 'f06', contributionReads: true }),
    /Controlled receipt reads require/,
  );
});
