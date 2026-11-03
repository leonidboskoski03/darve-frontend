import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Receives only the fresh URI created by the exact F08-04 local-api composition.
// Setup/seed authority stays Node-only; the actual public application gets a restricted role.
export async function createLocalSupportFixture(backend, uri, owner, policy) {
  const requireBackend = createRequire(join(backend, 'package.json'));
  const { Client } = requireBackend('pg');
  const sql = new Client({ connectionString: uri });
  await sql.connect();
  try {
    for (const name of [
      'b13-runtime-grants.sql',
      'b14-runtime-grants.sql',
      'b14-privacy-runtime-grants.sql',
    ])
      await sql.query(readFileSync(join(backend, 'infra/sql', name), 'utf8'));
    await sql.query(`CREATE ROLE f08_public LOGIN PASSWORD 'disposable-support-only' IN ROLE darve_public_runtime;
      CREATE ROLE f08_admin LOGIN PASSWORD 'disposable-support-only' IN ROLE darve_admin_runtime;
      GRANT SELECT ON darve_users,external_identities,darve_sessions TO darve_public_runtime;
      GRANT UPDATE(id) ON darve_users TO darve_public_runtime;
      GRANT UPDATE ON darve_sessions TO darve_public_runtime;`);
  } finally {
    await sql.end();
  }
  const db = await import(pathToFileURL(join(backend, 'packages/database/dist/index.js')).href);
  const domain = await import(pathToFileURL(join(backend, 'packages/domain/dist/index.js')).href);
  const integrations = await import(
    pathToFileURL(join(backend, 'packages/integrations/dist/index.js')).href
  );
  const roleUri = (role) => {
    const url = new URL(uri);
    url.username = role;
    url.password = 'disposable-support-only';
    return url.href;
  };
  const publicDatabase = db.createDatabase(roleUri('f08_public'), 5000);
  const admin = db.createDatabase(roleUri('f08_admin'), 5000);
  const staffPolicy = {
    ...(await import(pathToFileURL(join(backend, 'tests/fixtures/staff.ts')).href)).staffPolicy,
    epoch: randomUUID(),
  };
  const crypto = integrations.createStaffCrypto(
    randomBytes(32).toString('base64'),
    staffPolicy.epoch,
  );
  const principal = await owner.staffPrincipal.create({
    data: {
      id: randomUUID(),
      issuer: staffPolicy.issuer,
      subject: randomUUID(),
      epoch: staffPolicy.epoch,
      role: 'OWNER_ADMIN',
    },
  });
  const secret = crypto.secret(),
    csrf = crypto.csrf(secret),
    now = new Date();
  await owner.staffSession.create({
    data: {
      id: randomUUID(),
      principalId: principal.id,
      secretHash: crypto.hash(secret),
      csrfHash: crypto.hash(csrf),
      revision: 1,
      epoch: staffPolicy.epoch,
      assurancePolicy: staffPolicy.assurancePolicy,
      authenticatedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      idleUntil: new Date(now.getTime() + 600_000),
    },
  });
  const actor = {
    audience: 'staff',
    proof: { secretHash: crypto.hash(secret), csrfHash: crypto.hash(csrf) },
  };
  const service = domain.createSupportService(
    db.createSupportRepository(admin, policy, staffPolicy),
    integrations.createSupportCursorCrypto(randomBytes(32).toString('base64'), 'staff'),
    policy,
  );
  const ticket = (id) => service.ticket(actor, id);
  const command = (id, action, body) => service.execute(actor, id, action, randomUUID(), body);
  return {
    publicDatabase,
    async ban(userId) {
      return domain
        .createModerationService(db.createModerationRepository(admin, staffPolicy, true), crypto)
        .restrict(secret, csrf, userId, randomUUID(), {
          action: 'ban',
          expectedVersion: 0,
          reason: 'Synthetic support-access acceptance',
          confirmation: { targetId: userId, action: 'ban', expectedVersion: 0 },
        });
    },
    async close() {
      await Promise.allSettled([publicDatabase.$disconnect(), admin.$disconnect()]);
    },
    async staffReply(id, body) {
      const t = await ticket(id);
      return command(id, 'reply', {
        body,
        expectedRevision: t.revision,
        expectedAuthorityRevision: t.authorityRevision,
      });
    },
    async note(id, body) {
      const t = await ticket(id);
      return command(id, 'note', { body, expectedAuthorityRevision: t.authorityRevision });
    },
    async resolve(id) {
      const t = await ticket(id);
      return command(id, 'status', {
        status: 'resolved',
        expectedRevision: t.revision,
        expectedAuthorityRevision: t.authorityRevision,
        reason: 'Synthetic acceptance resolution',
      });
    },
    async revoke(sessionId) {
      await owner.darveSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });
    },
    async counts(id) {
      return {
        messages: await owner.supportMessage.count({ where: { ticketId: id, kind: 'public' } }),
        receipts: await owner.supportReceipt.count({
          where: { result: { path: ['ticketId'], equals: id }, audience: 'public' },
        }),
      };
    },
    async seedBroadcast(userId) {
      const identity = await owner.externalIdentity.create({
        data: {
          userId,
          provider: 'TWITCH',
          issuer: 'https://synthetic.invalid',
          subject: randomUUID(),
        },
      });
      const connection = await owner.providerConnection.create({
        data: { userId, provider: 'TWITCH', identityId: identity.id },
      });
      const channel = await owner.ownedChannel.create({
        data: {
          userId,
          connectionId: connection.id,
          provider: 'TWITCH',
          providerChannelId: randomUUID(),
          verifiedAt: new Date(),
        },
      });
      const id = randomUUID();
      await owner.broadcast.create({
        data: {
          id,
          userId,
          connectionId: connection.id,
          channelId: channel.id,
          provider: 'TWITCH',
          providerChannelId: channel.providerChannelId,
          providerBroadcastId: randomUUID(),
          incarnationKey: createHash('sha256').update(id).digest('hex'),
          status: 'ENDED',
          startedAt: new Date(),
          observedAt: new Date(),
        },
      });
      return id;
    },
    async assertPrivateIsolation(id) {
      const result =
        await publicDatabase.$queryRaw`SELECT body FROM support_messages WHERE "ticketId"=${id}::uuid AND kind='note'`;
      assert.equal(result.length, 0);
      const [role] =
        await publicDatabase.$queryRaw`SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`;
      assert.equal(role.name, 'f08_public');
      assert.equal(role.rolsuper, false);
      assert.equal(role.rolbypassrls, false);
    },
  };
}
