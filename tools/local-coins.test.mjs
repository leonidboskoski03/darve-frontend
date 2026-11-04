import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startLocalApi } from './local-api.mjs';
import { journalResourceNames, assertJournalOwnership } from './linux-coin-journal.mjs';
import { randomUUID } from 'node:crypto';

const selected = {
  backend: 'unused-invalid-path',
  task: 'f09-02',
  coins: true,
  port: 3310,
  origins: ['http://127.0.0.1:4175'],
};
test('coin acceptance rejects mixed scopes before backend, Docker or secret access', async () => {
  for (const task of ['f09-02', 'f09-g01']) {
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
        startLocalApi({ ...selected, task, ...override }),
        /Coins require their exact disposable/,
      );
  }
});
test('Linux journal names reject arbitrary paths and operations stay bound to owned resources', () => {
  for (const value of ['../../other', 'dev', '', randomUUID() + '/suffix'])
    assert.throws(() => journalResourceNames(value));
  const run = randomUUID();
  assert.match(journalResourceNames(run).volume, /^darve-f09-journal-/);
  const labels = { 'darve.frontend.task': 'f09-g01', 'darve.frontend.run': run };
  assert.doesNotThrow(() => assertJournalOwnership({ Labels: labels }, run));
  assert.doesNotThrow(() => assertJournalOwnership({ Config: { Labels: labels } }, run));
  assert.throws(() => assertJournalOwnership({ Labels: labels }, randomUUID()));
  assert.throws(() =>
    assertJournalOwnership({ Labels: { ...labels, 'darve.frontend.task': 'f09-02' } }, run),
  );
  assert.throws(() => assertJournalOwnership({}, run));
});
