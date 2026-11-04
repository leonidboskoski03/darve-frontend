import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { startLocalApi } from './local-api.mjs';

const evidence = resolve('artifacts.local/f09-g01');
mkdirSync(evidence, { recursive: true });
const backend = resolve(process.argv[2] ?? '../tmp/backend-f06-checkout');
const checks = [];
let api,
  phase = 'setup',
  result;
try {
  api = await startLocalApi({
    backend,
    task: 'f09-g01',
    coins: true,
    origins: ['http://127.0.0.1:4175'],
    port: 3310,
  });
  const fixture = api.coinFixture,
    d = fixture.durability;
  assert(d);
  const { coinEnvelope, CoinCreatorAccountDataSchema } = await import(
    pathToFileURL(join(backend, 'packages/contracts/dist/index.js')).href
  );
  const session = await api.seedSession({ coinOwner: true, expiresInMs: 180_000 });
  const account = async () => {
    const response = await fetch(api.apiOrigin + '/api/coins/account', {
      headers: { Cookie: 'darve_session=' + session.secret, Origin: 'http://127.0.0.1:4175' },
    });
    assert.equal(response.status, 200);
    return coinEnvelope(CoinCreatorAccountDataSchema).parse(await response.json()).data;
  };
  phase = 'Linux readiness';
  assert.equal(await d.journal.ready(), true);
  await d.worker().ready();
  assert.equal(d.journal.custody.network, 'none');
  assert.equal(d.journal.custody.readOnlyRoot, true);
  assert.deepEqual(d.journal.custody.capabilitiesDropped, ['ALL']);
  checks.push(
    'real pinned backend journal fsync succeeds on isolated Linux volume, UID 1000 and no network',
  );
  await fixture.configure();
  phase = 'pending credit';
  await d.adjust('20');
  assert.deepEqual(await account(), {
    balance: '20',
    spendableBalance: null,
    revision: 1,
    state: 'synchronization_pending',
    redemptionAllowed: false,
  });
  assert.equal((await d.inspect()).seals, 0);
  assert.deepEqual(await d.journal.read(), []);
  checks.push(
    'real synthetic Owner/Admin credit creates one SQL transaction and remains unspendable before durable acknowledgement',
  );
  phase = 'lost acknowledgement';
  const lostAck = {
    ...d.journal,
    append: async (record) => {
      await d.journal.append(record);
      throw Error('Injected worker interruption after durable append');
    },
  };
  await assert.rejects(d.worker(lostAck).tick(), /Injected worker interruption/);
  assert.equal((await d.journal.read()).length, 1);
  assert.equal((await d.inspect()).seals, 0);
  assert.equal((await account()).spendableBalance, null);
  await d.journal.restart();
  assert.equal((await d.journal.read()).length, 1);
  assert.equal((await d.worker().tick()).sealed, 1);
  assert.equal((await account()).spendableBalance, '20');
  for (let i = 0; i < 3; i++) assert.equal((await d.worker().tick()).sealed, 0);
  let state = await d.inspect();
  assert.equal(state.ledger, 1);
  assert.equal(state.seals, 1);
  assert.equal(state.account.balance, '20');
  checks.push(
    'lost acknowledgement plus actual container restart replays the same durable record and seals exactly once, preserving 20 coins',
  );
  phase = 'same-key debit';
  const key = randomUUID();
  await d.adjust('5', 'debit', 1, '20', key);
  await d.adjust('5', 'debit', 1, '20', key);
  state = await d.inspect();
  assert.equal(state.ledger, 2);
  assert.equal(state.seals, 1);
  assert.equal((await account()).balance, '15');
  assert.equal((await account()).spendableBalance, null);
  phase = 'stopped journal';
  await d.journal.stop();
  await assert.rejects(d.worker().tick());
  assert.equal((await d.inspect()).seals, 1);
  await d.journal.restart();
  checks.push(
    'same-key debit is charged once; stopped journal fails worker readiness and cannot acknowledge pending balance',
  );
  phase = 'wrong-key verification';
  const wrongKey = { ...d.journal, verify: (record) => d.journal.verifyWrongKey(record) };
  await assert.rejects(d.worker(wrongKey).tick());
  assert.equal((await d.inspect()).seals, 1);
  assert.equal((await account()).spendableBalance, null);
  assert.equal((await d.worker().tick()).sealed, 1);
  await d.adjust('5', 'debit', 1, '20', key);
  assert.equal((await d.worker().tick()).sealed, 0);
  assert.equal((await account()).spendableBalance, '15');
  checks.push(
    'actual wrong-key authentication failure cannot seal SQL; correct verified retry and same-key replay converge to 15 coins',
  );
  phase = 'binding and tamper';
  const records = (await d.journal.read()).sort((a, b) => a.sequence - b.sequence);
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((r) => r.sequence),
    [1, 2],
  );
  await assert.rejects(d.journal.readWrongBinding(randomUUID()));
  await assert.rejects(d.journal.tamperProbe(records[0]));
  assert.equal((await d.journal.read()).length, 2);
  const digests = await Promise.all(records.map((r) => d.journal.verify(r)));
  assert(digests.every((value) => /^[a-f0-9]{64}$/.test(value)));
  await d.journal.restart();
  assert.equal((await d.journal.read()).length, 2);
  assert.equal((await d.worker().tick()).sealed, 0);
  state = await d.inspect();
  assert.equal(state.ledger, 2);
  assert.equal(state.transactions, 2);
  assert.equal(state.seals, 2);
  assert.equal(state.account.balance, '15');
  checks.push(
    'wrong binding and byte tamper are rejected; independent primary chain survives restart with two records, two seals and no duplicate debit',
  );
  const paths = [
    'tools/linux-coin-journal-entry.mjs',
    'tools/linux-coin-journal.mjs',
    'tools/local-coin-fixture.mjs',
    'tools/local-coin-journal-acceptance.mjs',
    'tools/local-api.mjs',
  ];
  result = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    backendPin: api.source,
    checks,
    sourceInputs: Object.fromEntries(
      paths.map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
    ),
    custody: d.journal.custody,
    counts: { records: 2, seals: 2, ledger: 2, balance: '15' },
    syntheticAdjustments: true,
    canonicalEarningVerified: false,
    redemptionVerified: false,
    createdAt: new Date().toISOString(),
  };
} catch (error) {
  const detail = String(error.message)
    .replace(/(?:postgres(?:ql)?|redis):\/\/[^\s]+/g, '[private storage]')
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[redacted]');
  writeFileSync(
    join(evidence, 'failure.json'),
    JSON.stringify(
      { phase, name: error.name, detail, location: error.stack?.split('\n').slice(1, 6), checks },
      null,
      2,
    ),
  );
  console.error('F09-G01 failed during ' + phase + ': ' + detail);
  process.exitCode = 1;
} finally {
  await api?.close();
}
if (result) {
  writeFileSync(
    join(evidence, 'acceptance.json'),
    JSON.stringify({ ...result, cleanupComplete: true }, null, 2),
  );
  console.log(
    'Passed ' +
      checks.length +
      ' actual Linux journal/worker/SQL/HTTP checks; owned containers, volume and listeners cleaned.',
  );
}
