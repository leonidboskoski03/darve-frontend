import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startLocalApi } from './local-api.mjs';

const selected = {
  backend: 'unused-invalid-path',
  task: 'f09-02',
  coins: true,
  port: 3310,
  origins: ['http://127.0.0.1:4175'],
};
test('coin acceptance rejects mixed scopes before backend, Docker or secret access', async () => {
  for (const override of [
    { coins: false },
    { task: 'f08-08' },
    { port: 3000 },
    { origins: ['http://localhost:4175'] },
    { origins: ['http://127.0.0.1:4175', 'https://extra.example.test'] },
    ...[
      'support',
      'collection',
      'review',
      'reporting',
      'overlay',
      'terms',
      'checkout',
      'contributionReads',
    ].map((key) => ({ [key]: true })),
    { sandboxPayment: {} },
    { operatorOAuth: {} },
  ])
    await assert.rejects(
      startLocalApi({ ...selected, ...override }),
      /Coins require their exact disposable/,
    );
});
