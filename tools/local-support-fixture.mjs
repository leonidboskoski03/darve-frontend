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
    assurancePolicy: 'auth0-password-darve-email-otp-v1',
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
    async workbench(redis, { administration = false, recovery = false } = {}) {
      assert(!recovery || administration);
      const recoveryPolicy = {
        version: 'synthetic-recovery-v1',
        maximumExtensionSeconds: 120,
        maximumCumulativeSeconds: 180,
        maximumCommandsPerMinute: 100,
      };
      if (recovery) {
        const setup = new Client({ connectionString: uri });
        await setup.connect();
        try {
          await setup.query(
            readFileSync(join(backend, 'infra/sql/b14-recovery-runtime-grants.sql'), 'utf8'),
          );
        } finally {
          await setup.end();
        }
        await owner.$executeRaw`INSERT INTO support_recovery_settings(id,policy,"staffPolicy","consumersReady") VALUES(1,${JSON.stringify(recoveryPolicy)}::jsonb,${JSON.stringify(staffPolicy)}::jsonb,true)`;
      }
      const { createAdminApp } = await import(
        pathToFileURL(join(backend, 'apps/admin-api/dist/app.js')).href
      );
      const { createStaffRateLimitStore } = await import(
        pathToFileURL(join(backend, 'apps/admin-api/dist/composition/rate-limit-store.js')).href
      );
      const frontendOrigin = 'http://localhost:4176';
      const inbox = [],
        codes = new Map();
      let selectedIdentity = null;
      const provider = administration
        ? {
            configurationBinding: 'f08-06-controlled-password-fixture',
            authorization({ state, nonce, challenge }) {
              const url = new URL('http://localhost:3321/authorize');
              for (const [key, value] of Object.entries({
                state,
                nonce,
                code_challenge: challenge,
                response_type: 'code',
                client_id: 'controlled-staff',
                redirect_uri: 'http://localhost:3320/admin/v1/auth/callback',
                scope: 'openid email',
                code_challenge_method: 'S256',
                prompt: 'login',
                max_age: '0',
              }))
                url.searchParams.set(key, value);
              return url.href;
            },
            async exchange(code, verifier, nonce) {
              const entry = codes.get(code);
              codes.delete(code);
              assert(
                entry && entry.nonce === nonce && entry.challenge === crypto.challenge(verifier),
              );
              return {
                issuer: staffPolicy.issuer,
                subject: entry.subject,
                verifiedEmail: 'controlled-staff@example.test',
                authenticatedAt: (
                  await owner.$queryRaw`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`
                )[0].now,
                assurancePolicy: 'auth0-password-v1',
              };
            },
          }
        : null;
      const access = domain.createStaffAccessService(
        db.createStaffRepository(admin, staffPolicy, administration),
        provider,
        crypto,
        staffPolicy,
        frontendOrigin,
        administration
          ? {
              send: async (message) => {
                inbox.push(message);
              },
            }
          : null,
        true,
      );
      const app = createAdminApp({
        service: access,
        support: { service, crypto },
        recoveryContext: domain.createSupportRecoveryContextService(
          db.createSupportRecoveryContextRepository(
            admin,
            staffPolicy,
            recovery ? recoveryPolicy : null,
          ),
          crypto,
        ),
        ...(recovery
          ? {
              recovery: domain.createSupportRecoveryService(
                db.createSupportRecoveryRepository(admin),
                crypto,
              ),
            }
          : {}),
        ...(administration
          ? {
              moderation: domain.createModerationService(
                db.createModerationRepository(admin, staffPolicy, true),
                crypto,
              ),
            }
          : {}),
        config: { secure: false, frontendOrigin, loginSeconds: staffPolicy.loginSeconds },
        store: createStaffRateLimitStore(redis),
        ready: async () => db.staffRuntimeAuthorityReady(admin, true, recovery),
        log: () => {},
      });
      return {
        app,
        inbox,
        async recoveryReady(value) {
          assert(recovery);
          await owner.$executeRaw`UPDATE support_recovery_settings SET "consumersReady"=${value} WHERE id=1`;
        },
        async recoveryEvidence(challengeId) {
          assert(recovery);
          const funding = await owner.challengeFunding.findUniqueOrThrow({
            where: { challengeId },
          });
          const moneyKeys = [
            'state',
            'confirmedGross',
            'eligibleGross',
            'lateGross',
            'unclassifiedGross',
            'surplusGross',
            'refundedGross',
            'reversedGross',
            'adjustedGross',
            'goalReachedAt',
            'pendingCheckoutCount',
          ];
          return {
            challenge: await owner.acceptedChallenge.findUniqueOrThrow({
              where: { id: challengeId },
            }),
            funding: Object.fromEntries(moneyKeys.map((key) => [key, funding.snapshot[key]])),
            actions: await owner.supportRecoveryAction.findMany({
              where: { challengeId },
              orderBy: { createdAt: 'asc' },
            }),
            audits: await owner.staffAudit.count({ where: { resourceId: challengeId } }),
          };
        },
        async replacement(challengeId, creator, ageMs = 0) {
          assert(recovery);
          const challenge = await owner.acceptedChallenge.findUniqueOrThrow({
            where: { id: challengeId },
          });
          const round = await owner.collectionRound.findUniqueOrThrow({
            where: { id: challenge.roundId },
          });
          const original = await owner.broadcast.findUniqueOrThrow({
              where: { id: round.broadcastId },
            }),
            pc = await owner.providerConnection.findUniqueOrThrow({
              where: { id: original.connectionId },
              include: { channels: true },
            });
          const [clock] =
            await owner.$queryRaw`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
          const observedAt = new Date(clock.now.getTime() - ageMs);
          const result = await db.publishDiscoverySnapshot(
            owner,
            {
              userId: creator.userId,
              connectionId: pc.id,
              secretHash: createHash('sha256').update(creator.secret).digest('hex'),
            },
            {
              state: 'LIVE',
              reasonCode: null,
              complete: true,
              observedAt,
              freshnessMs: 30000,
              snapshotTtlMs: 60000,
              binding: {
                identityId: pc.identityId,
                credentialVersion: pc.credentialVersion,
                channels: pc.channels.map((ch) => ({
                  id: ch.id,
                  providerChannelId: ch.providerChannelId,
                })),
              },
              candidates: [
                {
                  channelId: original.channelId,
                  providerChannelId: original.providerChannelId,
                  providerBroadcastId: 'replacement_' + randomUUID(),
                  providerChatId: null,
                  startedAt: observedAt,
                  observedAt,
                  metricsAvailable: false,
                },
              ],
              chatContextAvailable: false,
            },
            10,
            (b) => ({ id: b.id, connectionId: b.connectionId, channelId: b.channelId }),
          );
          return result.items[0].id;
        },
        identityHandler(request, response) {
          assert(administration);
          const url = new URL(request.url, 'http://localhost:3321');
          const state = url.searchParams.get('state'),
            nonce = url.searchParams.get('nonce'),
            challenge = url.searchParams.get('code_challenge');
          if (
            request.method !== 'GET' ||
            url.pathname !== '/authorize' ||
            !selectedIdentity ||
            ![state, nonce, challenge].every((value) => /^[A-Za-z0-9_-]{43}$/.test(value ?? ''))
          ) {
            response.writeHead(400);
            response.end();
            return;
          }
          const code = randomBytes(32).toString('base64url');
          codes.set(code, { subject: selectedIdentity.subject, nonce, challenge });
          response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          });
          response.end(
            '<!doctype html><html lang="en"><title>Controlled identity fixture</title><h1>Controlled identity fixture</h1><p>Synthetic password evidence, not Auth0 acceptance.</p><form method="get" action="http://localhost:3320/admin/v1/auth/callback"><input type="hidden" name="state" value="' +
              state +
              '"><input type="hidden" name="code" value="' +
              code +
              '"><input type="hidden" name="iss" value="' +
              staffPolicy.issuer +
              '"><button>Continue controlled identity</button></form></html>',
          );
        },
        async selectIdentity(id) {
          assert(administration);
          selectedIdentity = await owner.staffPrincipal.findUniqueOrThrow({ where: { id } });
          assert(selectedIdentity.epoch === staffPolicy.epoch && selectedIdentity.active);
        },
        async ageIdentity(id) {
          assert(administration);
          await owner.staffSession.updateMany({
            where: { principalId: id },
            data: {
              authenticatedAt: new Date(
                Date.now() - (staffPolicy.recentAuthenticationSeconds + 30) * 1000,
              ),
            },
          });
        },
        async removeSetupOwner() {
          assert(administration);
          await owner.staffPrincipal.update({
            where: { id: principal.id },
            data: { active: false },
          });
        },
        async evidence(id) {
          assert(administration);
          return {
            principal: await owner.staffPrincipal.findUnique({
              where: { id },
              select: { id: true, role: true, active: true, revision: true },
            }),
            invitations: await owner.staffInvitation.count({ where: { createdBy: id } }),
            audit: await owner.staffAudit.count({ where: { actorId: id } }),
          };
        },
        async seed(role = 'SUPPORT') {
          assert(['SUPPORT', 'OWNER_ADMIN'].includes(role));
          const principal = await owner.staffPrincipal.create({
            data: {
              id: randomUUID(),
              issuer: staffPolicy.issuer,
              subject: randomUUID(),
              epoch: staffPolicy.epoch,
              role,
            },
          });
          const value = crypto.secret(),
            csrf = crypto.csrf(value),
            at = new Date();
          await owner.staffSession.create({
            data: {
              id: randomUUID(),
              principalId: principal.id,
              secretHash: crypto.hash(value),
              csrfHash: crypto.hash(csrf),
              revision: 1,
              epoch: staffPolicy.epoch,
              assurancePolicy: staffPolicy.assurancePolicy,
              authenticatedAt: at,
              expiresAt: new Date(at.getTime() + 600000),
              idleUntil: new Date(at.getTime() + 600000),
            },
          });
          return { id: principal.id, secret: value, csrf };
        },
        async reassign(id, assigneeId) {
          const t = await ticket(id);
          return command(id, 'reassign', {
            assigneeId,
            expectedAuthorityRevision: t.authorityRevision,
            reason: 'Controlled staff-workbench reassignment',
          });
        },
        async expire(id) {
          await owner.staffSession.updateMany({
            where: { principalId: id },
            data: { idleUntil: new Date(Date.now() - 1000) },
          });
        },
      };
    },
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
