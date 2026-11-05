import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, sep } from 'node:path';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

// Only called with this run's freshly migrated URI. No environment DB or credentials accepted.
export async function createLocalCoinFixture(
  backend,
  uri,
  owner,
  { linuxJournal = false, runId, task = 'f09-02', staffAuthority = null } = {},
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
      // Staff coin modes compose after support has installed the shared B13 roles.
      const grantFiles = ['f09-06', 'f09-07'].includes(task)
        ? ['b15-runtime-grants.sql']
        : ['b13-runtime-grants.sql', 'b15-runtime-grants.sql'];
      for (const file of grantFiles)
        await sql.query(readFileSync(join(backend, 'infra/sql', file), 'utf8'));
      await sql.query(`CREATE ROLE f09_public LOGIN PASSWORD 'disposable-coins-only' IN ROLE darve_public_runtime;
        CREATE ROLE f09_admin LOGIN PASSWORD 'disposable-coins-only' IN ROLE darve_admin_runtime;
        CREATE ROLE f09_worker LOGIN PASSWORD 'disposable-coins-only' IN ROLE darve_worker_runtime;
        GRANT SELECT ON darve_users,external_identities,darve_sessions TO darve_public_runtime;
        GRANT UPDATE(id) ON darve_users TO darve_public_runtime;
        GRANT UPDATE ON darve_sessions TO darve_public_runtime;`);
      if (['f09-03', 'f09-05', 'f09-07'].includes(task))
        await sql.query(
          'GRANT SELECT,INSERT ON terms_documents,terms_acceptances TO darve_public_runtime',
        );
      if (['f09-05', 'f09-07'].includes(task))
        await sql.query(`
        GRANT SELECT ON overlay_displays,overlay_grants,overlay_preferences,collection_rounds,provider_connections,collection_snapshot_access,analysis_runs,analysis_snapshots,analysis_profiles,analysis_processing_jobs,analysis_processing_results,accepted_challenges,challenge_public_links,challenge_completion_declarations,challenge_funding,challenge_funding_events,payment_checkout_attempts,financial_payments,financial_adjustment_evidence,funding_reviews TO darve_public_runtime;
        GRANT UPDATE("snapshotId") ON collection_snapshot_access TO darve_public_runtime;
        GRANT SELECT ON analysis_run_members,collection_submissions,analysis_processing_result_sources,payment_recipients,payment_guest_access TO darve_public_runtime;
        GRANT UPDATE(id) ON analysis_runs TO darve_public_runtime;
        GRANT INSERT,UPDATE ON overlay_displays,overlay_grants,overlay_preferences,challenge_funding,funding_reviews TO darve_public_runtime;
        GRANT INSERT ON outbox_events,challenge_funding_events TO darve_public_runtime;
        GRANT SELECT ON outbox_events TO darve_public_runtime;
        GRANT EXECUTE ON FUNCTION challenge_recovery_projection(uuid),challenge_effective_deadline(uuid) TO darve_public_runtime;`);
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
    assert.equal(['f09-06', 'f09-07'].includes(task), Boolean(staffAuthority));
    const fixture = staffAuthority
      ? await createCombinedCoinSeed(owner, admin, db, domain, staffAuthority)
      : await (
          await tsImport(
            pathToFileURL(join(backend, 'tests/fixtures/coins.ts')).href,
            import.meta.url,
          )
        ).coinFixture(owner, admin);
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
    // Node-only, task-bound controls install synthetic manifests into this disposable database.
    // No product asset, serving route, real renderer or commercial price is invented here.
    const assets = ['f09-04', 'f09-05', 'f09-06', 'f09-07'].includes(task)
      ? db.createTemplateAssetRepository(owner)
      : null;
    const templates = assets
      ? domain.createTemplateAdminService(
          db.createTemplateRepository(admin),
          fixture.crypto,
          integrations.createCoinCursorCrypto(randomBytes(32).toString('base64'), 'staff'),
          policy,
        )
      : null;
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
      staffWorkbench: ['f09-06', 'f09-07'].includes(task)
        ? async (adminDatabase, staffCrypto, staffPolicy) => {
            // Fresh disposable program only: align both real consumers with this workbench authority.
            await owner.coinProgram.update({ where: { id: 1 }, data: { staffPolicy } });
            return {
              coins: domain.createCoinAdminService(
                db.createCoinAdminRepository(adminDatabase),
                staffCrypto,
              ),
              templates: domain.createTemplateAdminService(
                db.createTemplateRepository(adminDatabase),
                staffCrypto,
                integrations.createCoinCursorCrypto(randomBytes(32).toString('base64'), 'staff'),
                policy,
              ),
            };
          }
        : null,
      async staffEvidence(actorId) {
        assert(['f09-06', 'f09-07'].includes(task));
        return {
          audits: await owner.staffAudit.findMany({
            where: { actorId, action: { in: ['coins.configure', 'coins.adjust', 'coins.price'] } },
            select: { action: true, reason: true },
          }),
          receipts: await owner.staffCommandReceipt.count({ where: { actorId } }),
          configurations: await owner.coinConfiguration.count(),
          prices: await owner.coinTemplatePrice.count(),
          ledger: await owner.coinLedger.count(),
        };
      },
      templates:
        assets && templates
          ? {
              installManifest: (manifest) => assets.install(manifest),
              install: (id = 'fixture_premium', version = 1) =>
                assets.install({
                  id,
                  displayName: 'Synthetic ' + id,
                  version,
                  rendererKey: 'fixture_renderer',
                  assetHash: 'a'.repeat(64),
                  approvalHash: 'b'.repeat(64),
                }),
              price: (id, amount, expectedRevision) =>
                templates.price(
                  fixture.owner.secret,
                  fixture.crypto.csrf(fixture.owner.secret),
                  id,
                  randomUUID(),
                  {
                    expectedRevision,
                    amount,
                    reason: 'Synthetic disposable F09-04 price',
                    confirmation: { templateId: id },
                  },
                ),
              withdraw: (id, version) => assets.withdraw(id, version, 'unavailable'),
              async inspect() {
                return {
                  redemptions: await owner.coinRedemption.count(),
                  entitlements: await owner.coinEntitlement.count(),
                  debits: await owner.coinLedger.count({ where: { redemptionId: { not: null } } }),
                };
              },
            }
          : null,
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

async function createCombinedCoinSeed(owner, admin, db, domain, authority) {
  // Fresh combined staff-coin storage only; reuse its support authority without a second bootstrap.
  const program = randomUUID(),
    binding = randomUUID();
  await owner.coinProgram.create({
    data: {
      id: 1,
      identity: program,
      journalBinding: binding,
      staffPolicy: authority.policy,
      consumersReady: true,
    },
  });
  const accountOwner = await owner.darveUser.create({ data: {} }),
    service = domain.createCoinAdminService(db.createCoinAdminRepository(admin), authority.crypto),
    rewards = {
      'collection.first_success': '20',
      'funding.first_goal': '40',
      'completion.first_declaration': '40',
      'suggestions.10': '10',
      'suggestions.100': '100',
      'suggestions.1000': '1000',
    };
  return {
    program,
    binding,
    accountOwner,
    service,
    crypto: authority.crypto,
    owner: { secret: authority.secret },
    configure: () =>
      service.execute(
        authority.secret,
        authority.crypto.csrf(authority.secret),
        'configure',
        null,
        randomUUID(),
        {
          expectedRevision: 0,
          active: true,
          rewards,
          reason: 'Synthetic isolated F09-06 rewards',
          confirmation: { programId: program },
        },
      ),
    adjust: (
      amount,
      direction = 'credit',
      expectedRevision = 0,
      balance = '0',
      key = randomUUID(),
    ) =>
      service.execute(
        authority.secret,
        authority.crypto.csrf(authority.secret),
        'adjust',
        accountOwner.id,
        key,
        {
          expectedRevision,
          direction,
          amount,
          reason: 'Synthetic isolated F09-06 initial credit',
          confirmation: { ownerId: accountOwner.id, balance },
        },
      ),
  };
}
