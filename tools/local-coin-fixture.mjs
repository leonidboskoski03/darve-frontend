import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, sep } from 'node:path';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// Only called with this run's freshly migrated URI. No environment DB or credentials accepted.
export async function createLocalCoinFixture(
  backend,
  uri,
  owner,
  { linuxJournal = false, runId, task = 'f09-02' } = {},
) {
  const load = (file) => import(pathToFileURL(join(backend, file)).href);
  const requireBackend = createRequire(join(backend, 'package.json'));
  const { Client } = requireBackend('pg');
  const { tsImport } = await import(pathToFileURL(requireBackend.resolve('tsx/esm/api')).href);
  const db = await load('packages/database/dist/index.js');
  const integrations = await load('packages/integrations/dist/index.js');
  const domain = await load('packages/domain/dist/index.js');
  const sql = new Client({ connectionString: uri });
  const connections = [];
  const root = linuxJournal ? null : resolve(mkdtempSync(join(tmpdir(), 'darve-f09-journal-')));
  const parent = resolve(tmpdir()) + sep;
  let durableJournal;
  const close = async () => {
    await durableJournal?.close();
    await Promise.all(connections.map((connection) => connection.$disconnect()));
    if (root) {
      assert(root.startsWith(parent) && root !== resolve(tmpdir()));
      rmSync(root, { recursive: true, force: true });
    }
  };
  try {
    await sql.connect();
    try {
      for (const file of ['b13-runtime-grants.sql', 'b15-runtime-grants.sql'])
        await sql.query(readFileSync(join(backend, 'infra/sql', file), 'utf8'));
      await sql.query(`CREATE ROLE f09_public LOGIN PASSWORD 'disposable-coins-only' IN ROLE darve_public_runtime;
        CREATE ROLE f09_admin LOGIN PASSWORD 'disposable-coins-only' IN ROLE darve_admin_runtime;
        CREATE ROLE f09_worker LOGIN PASSWORD 'disposable-coins-only' IN ROLE darve_worker_runtime;
        GRANT SELECT ON darve_users,external_identities,darve_sessions TO darve_public_runtime;
        GRANT UPDATE(id) ON darve_users TO darve_public_runtime;
        GRANT UPDATE ON darve_sessions TO darve_public_runtime;`);
      if (task === 'f09-03')
        await sql.query(
          'GRANT SELECT,INSERT ON terms_documents,terms_acceptances TO darve_public_runtime',
        );
    } finally {
      await sql.end();
    }
    const connection = (role) => {
      const url = new URL(uri);
      url.username = role;
      url.password = 'disposable-coins-only';
      const value = db.createDatabase(url.href, 5000);
      connections.push(value);
      return value;
    };
    const publicDatabase = connection('f09_public'),
      admin = connection('f09_admin'),
      worker = connection('f09_worker');
    // Scoped tsx resolves the backend test sources' .js -> .ts imports without a global loader.
    const { coinFixture } = await tsImport(
      pathToFileURL(join(backend, 'tests/fixtures/coins.ts')).href,
      import.meta.url,
    );
    const fixture = await coinFixture(owner, admin);
    const cursorKey = randomBytes(32).toString('base64');
    const policy = {
      programId: fixture.program,
      journalBinding: fixture.binding,
      pageSize: 1,
      cursorSeconds: task === 'f09-03' ? 30 : 60,
    };
    durableJournal = linuxJournal
      ? await (
          await import('./linux-coin-journal.mjs')
        ).createLinuxCoinJournal({
          backend,
          program: fixture.program,
          binding: fixture.binding,
          runId,
          task,
        })
      : null;
    const journal =
      durableJournal ??
      integrations.createCoinJournal(
        root,
        randomBytes(32),
        fixture.program,
        fixture.binding,
        16384,
      );
    const workerAuthorityReady = await db
      .createCoinRecoveryRepository(worker)
      .ready(fixture.program, fixture.binding);
    assert.equal(workerAuthorityReady, true);
    const journalReady = await journal.ready();
    // Windows cannot fsync directories. Keep this real readiness failure visible;
    // no worker tick, earning, adjustment or redemption is exposed by this fixture.
    if (linuxJournal || process.platform !== 'win32') assert.equal(journalReady, true);
    assert.deepEqual(await journal.read(), []);
    return {
      publicDatabase,
      custody: { workerAuthorityReady, journalReady, durableWritesQualified: false },
      durability: durableJournal
        ? {
            ownerId: fixture.accountOwner.id,
            journal: durableJournal,
            adjust: fixture.adjust,
            worker: (port = durableJournal) =>
              domain.createCoinRecoveryService(db.createCoinRecoveryRepository(worker), port, {
                programId: fixture.program,
                journalBinding: fixture.binding,
                batchSize: 10,
                pollMs: 1000,
                maxRecordBytes: 16384,
              }),
            async inspect() {
              return {
                seals: await owner.coinSeal.count(),
                ledger: await owner.coinLedger.count(),
                transactions: await owner.coinTransaction.count(),
                capturedFacts: await owner.coinFact.count({
                  where: { ownerId: fixture.accountOwner.id },
                }),
                qualifyingUnits:
                  (
                    await owner.coinFact.aggregate({
                      where: { ownerId: fixture.accountOwner.id },
                      _sum: { units: true },
                    })
                  )._sum.units ?? 0,
                account: await fixture.service.read(fixture.owner.secret, fixture.accountOwner.id),
              };
            },
          }
        : null,
      environment: {
        COIN_CONSUMER_POLICY_JSON: JSON.stringify(policy),
        COIN_CREATOR_CURSOR_KEY_BASE64: cursorKey,
      },
      configure: () => fixture.configure(),
      async unavailable(value) {
        await owner.coinProgram.update({ where: { id: 1 }, data: { consumersReady: !value } });
      },
      async facts() {
        return {
          configurations: await owner.coinConfiguration.count(),
          accounts: await owner.coinAccount.count(),
          ledger: await owner.coinLedger.count(),
          entitlements: await owner.coinEntitlement.count(),
          journalRecords: (await journal.read()).length,
        };
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
