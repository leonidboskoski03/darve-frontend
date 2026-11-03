import assert from 'node:assert/strict';
import test from 'node:test';
import { startLocalApi } from './local-api.mjs';

for (const task of ['f08-04', 'f08-05', 'f08-06'])
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
