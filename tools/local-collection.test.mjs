import assert from 'node:assert/strict';
import test from 'node:test';
import { startLocalApi } from './local-api.mjs';
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
