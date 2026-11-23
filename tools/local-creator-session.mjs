import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const frontendOrigin = 'http://localhost:5173';
export const apiOrigin = 'http://localhost:3000';
export const signInOrigin = 'http://localhost:3103';
const lifetimeSeconds = 1800;

function runFixture(operation, secret = '') {
  const input = `
    import { createDatabase } from '@darve/database';
    import { hashProof, sessionCsrfProof } from './apps/api/dist/security/proofs.js';
    if (process.env.DARVE_PROFILE !== 'development' ||
        process.env.NODE_ENV !== 'development' || process.env.LOCAL_STACK_RUNTIME !== '1')
      throw new Error('Canonical development API required');
    const db = createDatabase(process.env.DATABASE_URL, 5000);
    try {
      const userId = 'c80949c0-0f8e-4170-ae0f-faf8147fa8bc';
      const secret = ${JSON.stringify(secret)};
      switch (${JSON.stringify(operation)}) {
        case 'create':
          await db.externalIdentity.findFirstOrThrow({
            where: { userId, issuer: 'https://local-fixtures.invalid', subject: 'darve-local-creator' },
          });
          await db.darveSession.create({ data: {
            userId, secretHash: hashProof(secret), csrfHash: hashProof(sessionCsrfProof(secret)),
            expiresAt: new Date(Date.now() + ${lifetimeSeconds} * 1000),
          } });
          break;
        case 'challenge': {
          const link = await db.challengePublicLink.findFirst({
            where: { challenge: { userId } },
            orderBy: { challenge: { acceptedAt: 'desc' } },
            select: { publicId: true },
          });
          if (link) process.stdout.write(link.publicId);
          break;
        }
      }
    } finally {
      await db.$disconnect();
    }
  `;
  const child = spawnSync(
    'docker',
    ['exec', '-i', 'darve-local-api-1', 'node', '--input-type=module', '-'],
    { input, encoding: 'utf8', timeout: 12000, windowsHide: true },
  );
  if (child.status !== 0)
    throw new Error('Start darve-local in full mode and run local:seed if needed.');
  return child.stdout.trim();
}

export function localChallengeId() {
  const id = runFixture('challenge');
  if (!/^[0-9a-f-]{36}$/.test(id))
    throw new Error(
      'Accept a sandbox challenge for the local creator before running the walkthrough.',
    );
  return id;
}

export async function startCreatorSignIn() {
  let issued = false;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; form-action 'self' http://localhost:5173; base-uri 'none'",
    );
    if (request.headers.host !== 'localhost:3103' || request.url !== '/') {
      response.writeHead(404).end();
      return;
    }
    if (request.method === 'GET') {
      response
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(
          '<!doctype html><html lang="en"><title>Darve local creator</title><main><h1>Darve local creator</h1><form method="post"><button>Sign in as the local test creator</button></form></main></html>',
        );
      return;
    }
    if (
      issued ||
      request.method !== 'POST' ||
      request.headers.origin !== signInOrigin ||
      request.headers['sec-fetch-site'] !== 'same-origin'
    ) {
      response.writeHead(403).end();
      return;
    }
    try {
      const secret = randomBytes(32).toString('base64url');
      runFixture('create', secret);
      issued = true;
      response
        .writeHead(303, {
          Location: frontendOrigin + '/dashboard',
          'Set-Cookie': `darve_session=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetimeSeconds}`,
        })
        .end();
      server.close();
    } catch {
      response.writeHead(503).end('Start darve-local in full mode and run local:seed if needed.');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3103, '127.0.0.1', resolve);
  });
  const timer = setTimeout(() => server.close(), 120000);
  server.once('close', () => clearTimeout(timer));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await startCreatorSignIn();
    console.log('Open ' + signInOrigin + ' within two minutes to sign in as the seeded creator.');
  } catch {
    console.error('Could not open the local creator sign-in. Check port 3103.');
    process.exitCode = 1;
  }
}
