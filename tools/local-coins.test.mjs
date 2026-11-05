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

test('combined coin acceptance requires exactly its local creator/staff/OBS capabilities and journal ownership', async () => {
  const input = {
    ...selected,
    task: 'f09-07',
    support: true,
    collection: true,
    review: true,
    terms: true,
    overlay: true,
  };
  for (const override of [
    { coins: false },
    { support: false },
    { collection: false },
    { review: false },
    { terms: false },
    { overlay: false },
    { reporting: true },
    { checkout: true },
    { contributionReads: true },
    { operatorOAuth: {} },
    { sandboxPayment: {} },
    { port: 3000 },
    { origins: ['https://other.example.test'] },
    { qrPublicOrigin: 'https://external.example.test' },
  ])
    await assert.rejects(
      startLocalApi({ ...input, ...override }),
      /Coins require|Creator support acceptance requires|Mobile QR origin/,
    );
  const run = randomUUID(),
    labels = { 'darve.frontend.task': 'f09-07', 'darve.frontend.run': run };
  assert.doesNotThrow(() => assertJournalOwnership({ Labels: labels }, run, 'f09-07'));
  assert.throws(() => assertJournalOwnership({ Labels: labels }, run, 'f09-06'));
});

test('staff coin acceptance permits only exact coins/support composition and matching journal labels', async () => {
  const input = { ...selected, task: 'f09-06', support: true };
  for (const override of [
    { coins: false },
    { support: false },
    { collection: true },
    { review: true },
    { terms: true },
    { overlay: true },
    { reporting: true },
    { checkout: true },
    { contributionReads: true },
    { operatorOAuth: {} },
    { sandboxPayment: {} },
    { port: 3000 },
    { origins: ['https://other.example.test'] },
  ])
    await assert.rejects(
      startLocalApi({ ...input, ...override }),
      /Coins require|Creator support acceptance requires/,
    );
  const run = randomUUID(),
    labels = { 'darve.frontend.task': 'f09-06', 'darve.frontend.run': run };
  assert.doesNotThrow(() => assertJournalOwnership({ Labels: labels }, run, 'f09-06'));
  assert.throws(() => assertJournalOwnership({ Labels: labels }, run, 'f09-05'));
});
test('coin acceptance rejects mixed scopes before backend, Docker or secret access', async () => {
  for (const task of ['f09-02', 'f09-g01', 'f09-04']) {
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
  const templates = { ...labels, 'darve.frontend.task': 'f09-04' };
  assert.doesNotThrow(() => assertJournalOwnership({ Labels: templates }, run, 'f09-04'));
  assert.throws(() => assertJournalOwnership({ Labels: templates }, run, 'f09-g01'));
});
test('creator coin acceptance requires its exact collection/review/terms composition', async () => {
  const input = { ...selected, task: 'f09-03', collection: true, review: true, terms: true };
  for (const override of [
    { coins: false },
    { collection: false },
    { review: false },
    { terms: false },
    { support: true },
    { reporting: true },
    { overlay: true },
    { checkout: true },
    { operatorOAuth: {} },
    { sandboxPayment: {} },
  ])
    await assert.rejects(
      startLocalApi({ ...input, ...override }),
      /Coins require their exact disposable/,
    );
  const run = randomUUID(),
    labels = { 'darve.frontend.task': 'f09-03', 'darve.frontend.run': run };
  assert.doesNotThrow(() => assertJournalOwnership({ Labels: labels }, run, 'f09-03'));
  assert.throws(() => assertJournalOwnership({ Labels: labels }, run, 'f09-g01'));
});
test('template OBS acceptance requires exact isolated overlay/coins/review/terms composition and journal custody', async () => {
  const input = {
    ...selected,
    task: 'f09-05',
    collection: true,
    review: true,
    terms: true,
    overlay: true,
  };
  for (const override of [
    { coins: false },
    { collection: false },
    { review: false },
    { terms: false },
    { overlay: false },
    { support: true },
    { checkout: true },
    { reporting: true },
    { contributionReads: true },
    { operatorOAuth: {} },
    { sandboxPayment: {} },
    { port: 3000 },
    { origins: ['https://other.example.test'] },
  ])
    await assert.rejects(
      startLocalApi({ ...input, ...override }),
      /Coins require their exact disposable/,
    );
  const run = randomUUID(),
    labels = { 'darve.frontend.task': 'f09-05', 'darve.frontend.run': run };
  assert.doesNotThrow(() => assertJournalOwnership({ Labels: labels }, run, 'f09-05'));
  assert.throws(() => assertJournalOwnership({ Labels: labels }, run, 'f09-04'));
});
