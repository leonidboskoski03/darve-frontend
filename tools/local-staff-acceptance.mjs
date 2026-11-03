import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build, preview } from 'vite';
import { chromium, devices } from '@playwright/test';

// Explicit disposable qualification only: no ordinary database URL, external IdP or managed email.
const backend = resolve(process.argv[2] ?? '../tmp/backend-f06-checkout');
const evidence = resolve('artifacts.local/f08-03');
mkdirSync(evidence, { recursive: true });
const output = resolve(evidence, 'runtime-build');
assert(output.startsWith(evidence + sep) && output !== evidence);
const run = (command, args, options = {}) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }).trim();
  } catch {
    throw new Error('Scoped staff acceptance command failed. Private arguments are not logged.');
  }
};
const git = (...args) => run('git', args, { cwd: backend });
const manifest = JSON.parse(readFileSync('vendor/contracts/provenance.json', 'utf8'));
const fingerprintSource = () => {
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(
      (file) =>
        file &&
        ((file.startsWith('src/') &&
          !/\.(?:test|test-helper|test-support)\./.test(file) &&
          !file.startsWith('src/app/preview/')) ||
          file.startsWith('public/') ||
          /^(?:staff\.html|vite\.staff\.config\.ts|package(?:-lock)?\.json|tsconfig[^/]*\.json|tools\/local-staff-acceptance\.mjs)$/.test(
            file,
          )),
    );
  return Object.fromEntries(
    [...new Set(files)]
      .sort()
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  );
};
const sourceInputs = fingerprintSource();
assert.equal(git('rev-parse', 'HEAD'), manifest.sourceRevision);
assert.equal(git('status', '--porcelain'), '');
assert.equal(existsSync(join(backend, '.env')), false);
const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
run(process.execPath, [npm, 'run', 'build'], { cwd: backend });
const requireBackend = createRequire(join(backend, 'package.json'));
const load = async (name) => import(pathToFileURL(requireBackend.resolve(name)).href);
const databasePackage = await import(
  pathToFileURL(join(backend, 'packages/database/dist/index.js')).href
);
const domain = await import(pathToFileURL(join(backend, 'packages/domain/dist/index.js')).href);
const integrations = await import(
  pathToFileURL(join(backend, 'packages/integrations/dist/index.js')).href
);
const { Redis } = await load('ioredis');
const { createAdminApp } = await import(
  pathToFileURL(join(backend, 'apps/admin-api/dist/app.js')).href
);
const { createStaffRateLimitStore } = await import(
  pathToFileURL(join(backend, 'apps/admin-api/dist/composition/rate-limit-store.js')).href
);
const { staffPolicy } = await import(pathToFileURL(join(backend, 'tests/fixtures/staff.ts')).href);
const { provisionStaffRuntimeFixture } = await import(
  pathToFileURL(join(backend, 'tests/integration/staff-runtime-fixture.ts')).href
);
const runId = randomUUID();
const names = [];
const checks = [];
let current = 'setup',
  db,
  admin,
  redis,
  apiServer,
  providerServer,
  mailServer,
  site,
  browser;
let detail = 'setup';
let observedPage;
const front = 'http://localhost:4176';
const api = 'http://localhost:3320';
const authorizationEndpoint = 'http://localhost:3321/authorize';
const inbox = [];
let subject = 'controlled-owner';
const policy = {
  ...staffPolicy,
  epoch: randomUUID(),
  issuer: 'https://controlled-staff.example.test/',
  assurancePolicy: 'auth0-password-darve-email-otp-v1',
};
const crypto = integrations.createStaffCrypto(randomBytes(32).toString('base64'), policy.epoch);
const codes = new Map();
const network = {
  creatorCookieSeen: false,
  staffCookieSeen: false,
  privateReferrerSeen: false,
  mutations: [],
  statuses: [],
};
const listen = (server, port, host) =>
  new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      done();
    });
  });
const closeServer = (server) =>
  server
    ? new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      })
    : Promise.resolve();
const check = async (name, action) => {
  current = name;
  const start = performance.now();
  await action();
  checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) });
  console.log(JSON.stringify({ check: name, passed: true }));
};
const startContainer = (suffix, image, environment, port, tmpfs) => {
  const name = 'darve-f08-staff-' + runId.slice(0, 8) + '-' + suffix;
  names.push(name);
  run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--label',
    'darve.frontend.run=' + runId,
    '--label',
    'darve.frontend.task=f08-03',
    '--tmpfs',
    tmpfs,
    '--publish',
    '127.0.0.1::' + port,
    ...Object.entries(environment).flatMap(([key, value]) => ['--env', key + '=' + value]),
    image,
  ]);
  const mapping = run('docker', ['port', name, port + '/tcp']);
  assert.match(mapping, /^127\.0\.0\.1:\d+$/);
  return { name, port: Number(mapping.split(':')[1]) };
};
const waitContainer = async (name, args) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      run('docker', ['exec', name, ...args]);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  throw Error('Disposable dependency did not become ready.');
};
const observe = (context) =>
  context
    .on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === api)
        network.statuses.push({ path: url.pathname, status: response.status() });
    })
    .on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== api) return;
      const headers = request.headers();
      network.creatorCookieSeen ||= (headers.cookie ?? '').includes('darve_session=');
      network.privateReferrerSeen ||= (headers.referer ?? '').includes('invitation=');
      if (request.method() === 'POST') network.mutations.push(url.pathname);
    });
const heading = (page, text) => {
  observedPage = page;
  detail = 'waiting for ' + text;
  return page.getByRole('heading', { name: text, exact: true }).waitFor();
};
async function approveIdentity(page) {
  await heading(page, 'Controlled identity fixture');
  await page.getByRole('button', { name: 'Continue controlled identity' }).click();
  await heading(page, 'Check your email');
}
async function verifyLatest(page) {
  assert(inbox.length > 0);
  await page.getByLabel(/Email verification code/).fill(inbox.at(-1).code);
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
}
const staffSecret = async (context) => {
  const cookie = (await context.cookies(api)).find(
    (value) => value.name === 'darve_staff_dev_session',
  );
  assert(cookie?.httpOnly && cookie.path === '/' && cookie.sameSite === 'Lax');
  return cookie.value;
};
try {
  current = 'disposable-dependencies';
  const password = randomBytes(24).toString('base64url');
  const pg = startContainer(
    'postgres',
    'pgvector/pgvector:0.8.7-pg16@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a',
    { POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: password, POSTGRES_DB: 'darve' },
    5432,
    '/var/lib/postgresql/data:rw,noexec,nosuid,size=512m',
  );
  const cache = startContainer(
    'redis',
    'redis@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499',
    {},
    6379,
    '/data:rw,noexec,nosuid,size=32m',
  );
  await waitContainer(pg.name, ['pg_isready', '-U', 'postgres', '-d', 'darve', '-q']);
  await waitContainer(cache.name, ['redis-cli', 'ping']);
  const uri = new URL('postgresql://127.0.0.1:' + pg.port + '/darve');
  uri.username = 'postgres';
  uri.password = password;
  run(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--config',
      'packages/database/prisma.config.ts',
    ],
    { cwd: backend, env: { ...process.env, DATABASE_URL: uri.href } },
  );
  const cwd = process.cwd();
  let roles;
  try {
    process.chdir(backend);
    roles = await provisionStaffRuntimeFixture(uri.href);
  } finally {
    process.chdir(cwd);
  }
  db = databasePackage.createDatabase(uri.href, 5000);
  admin = databasePackage.createDatabase(roles.admin, 5000);
  redis = new Redis('redis://127.0.0.1:' + cache.port, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  await redis.connect();
  assert(await databasePackage.staffRuntimeAuthorityReady(admin));
  mailServer = createServer(async (request, response) => {
    try {
      assert(request.method === 'POST' && request.url === '/messages');
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        assert(body.length <= 4096);
      }
      const message = JSON.parse(body);
      assert.match(message.code, /^\d{8}$/);
      inbox.push(message);
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
    } catch {
      response.writeHead(400);
      response.end();
    }
  });
  await listen(mailServer, 0, '127.0.0.1');
  const delivery = integrations.createStaffTestEmailDelivery(
    'http://127.0.0.1:' + mailServer.address().port + '/messages',
    'test',
  );
  const service = domain.createStaffAccessService(
    databasePackage.createStaffRepository(admin, policy),
    {
      configurationBinding: 'f08-controlled-identity-v1',
      authorization({ state, nonce, challenge }) {
        const url = new URL(authorizationEndpoint);
        for (const [key, value] of Object.entries({
          state,
          nonce,
          code_challenge: challenge,
          response_type: 'code',
          client_id: 'controlled-staff',
          redirect_uri: api + '/admin/v1/auth/callback',
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
        assert(entry && entry.nonce === nonce && entry.challenge === crypto.challenge(verifier));
        const at = (
          await db.$queryRaw`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`
        )[0].now;
        return {
          issuer: policy.issuer,
          subject: entry.subject,
          verifiedEmail: 'staff@example.test',
          authenticatedAt: at,
          assurancePolicy: 'auth0-password-v1',
        };
      },
    },
    crypto,
    policy,
    front,
    delivery,
  );
  providerServer = createServer((request, response) => {
    const url = new URL(request.url, authorizationEndpoint);
    if (request.method !== 'GET' || url.pathname !== '/authorize') {
      response.writeHead(404);
      response.end();
      return;
    }
    const state = url.searchParams.get('state'),
      nonce = url.searchParams.get('nonce'),
      challenge = url.searchParams.get('code_challenge');
    if (![state, nonce, challenge].every((value) => /^[A-Za-z0-9_-]{43}$/.test(value ?? ''))) {
      response.writeHead(400);
      response.end();
      return;
    }
    const code = randomBytes(32).toString('base64url');
    codes.set(code, { subject, nonce, challenge });
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(
      '<!doctype html><title>Controlled identity fixture</title><h1>Controlled identity fixture</h1><p>Local synthetic identity proof. This is not Auth0 password acceptance.</p><form method="get" action="' +
        api +
        '/admin/v1/auth/callback"><input type="hidden" name="state" value="' +
        state +
        '"><input type="hidden" name="code" value="' +
        code +
        '"><input type="hidden" name="iss" value="' +
        policy.issuer +
        '"><button>Continue controlled identity</button></form>',
    );
  });
  await listen(providerServer, 3321, 'localhost');
  const app = createAdminApp({
    service,
    config: { secure: false, frontendOrigin: front, loginSeconds: policy.loginSeconds },
    store: createStaffRateLimitStore(redis),
    ready: async () =>
      redis.status === 'ready' && (await databasePackage.staffRuntimeAuthorityReady(admin)),
    log: () => {},
  });
  apiServer = createServer((request, response) => {
    const cookies = request.headers.cookie ?? '';
    network.creatorCookieSeen ||= /(?:^|;\s*)darve_session=/.test(cookies);
    network.staffCookieSeen ||= /(?:^|;\s*)darve_staff_dev_session=/.test(cookies);
    network.privateReferrerSeen ||= (request.headers.referer ?? '').includes('invitation=');
    app(request, response);
  });
  await listen(apiServer, 3320, 'localhost');
  process.env.STAFF_PUBLIC_APP_ENV = 'local';
  process.env.STAFF_PUBLIC_API_ORIGIN = api;
  process.env.STAFF_PUBLIC_AUTHORIZATION_ENDPOINT = authorizationEndpoint;
  current = 'isolated-staff-build';
  const modules = new Set();
  await build({
    configFile: resolve('vite.staff.config.ts'),
    envDir: false,
    mode: 'staff-acceptance',
    logLevel: 'silent',
    build: { outDir: output, emptyOutDir: true },
    plugins: [
      {
        name: 'staff-import-proof',
        generateBundle(_options, bundle) {
          for (const chunk of Object.values(bundle))
            if (chunk.type === 'chunk')
              for (const id of chunk.moduleIds) modules.add(id.replaceAll('\\', '/'));
        },
      },
    ],
  });
  assert(
    [...modules].every(
      (id) =>
        !/\/src\/(?:features\/(?:creator-access|landing|contributions|overlay-display)|services\/creator-session|routes\/(?:router|creator-runtime))\b/.test(
          id,
        ),
    ),
  );
  assert(!existsSync(join(output, 'index.html')) && !existsSync(join(output, 'overlay.html')));
  site = await preview({
    configFile: resolve('vite.staff.config.ts'),
    envDir: false,
    mode: 'staff-acceptance',
    logLevel: 'silent',
    build: { outDir: output },
    preview: { port: 4176, strictPort: true },
  });
  browser = await chromium.launch();
  const owner = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    reducedMotion: 'reduce',
  });
  observe(owner);
  await owner.addCookies([
    {
      name: 'darve_session',
      value: crypto.secret(),
      url: 'http://127.0.0.1:3310',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await owner.newPage();
  await check('separate-production-entry-and-cookie-hosts', async () => {
    const response = await page.goto(front);
    await heading(page, 'Sign in to Darve staff');
    assert.equal(response.headers()['referrer-policy'], 'no-referrer');
    assert.equal(response.headers()['cache-control'], 'no-store');
    assert(response.headers()['content-security-policy'].includes(api));
    assert.equal((await owner.request.get(front + '/index.html')).status(), 404);
    assert.equal((await owner.request.get(front + '/overlay.html')).status(), 404);
    await page.screenshot({ path: join(evidence, 'staff-signed-out-desktop.png') });
  });
  const invitation = await service.bootstrap({
    issuer: policy.issuer,
    epoch: policy.epoch,
    subject,
    nonce: crypto.secret(),
    expiresAt: new Date(Date.now() + 240000),
    reason: 'F08 isolated browser qualification',
  });
  await check('invitation-capture-controlled-identity-and-real-email-code', async () => {
    await page.goto(invitation.acceptanceUrl);
    await heading(page, 'You’ve been invited');
    assert.equal(new URL(page.url()).hash, '');
    await page.getByRole('button', { name: 'Continue to staff sign-in' }).click();
    await approveIdentity(page);
    assert.equal(await db.staffPrincipal.count(), 0);
    await page
      .getByLabel(/Email verification code/)
      .fill(inbox.at(-1).code === '00000000' ? '11111111' : '00000000');
    await page.getByRole('button', { name: 'Verify code', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'could not be verified' }).waitFor();
    assert.equal(await page.getByLabel(/Email verification code/).inputValue(), '');
  });
  await check('real-resend-and-explicit-role-acceptance-once', async () => {
    const row = await db.staffEmailCode.findFirstOrThrow({ where: { consumed: false } });
    await db.$executeRaw`UPDATE staff_email_codes SET "createdAt"="createdAt"-interval '61 seconds',"sentAt"="sentAt"-interval '61 seconds',"expiresAt"="expiresAt"-interval '61 seconds',"authenticatedAt"="authenticatedAt"-interval '61 seconds' WHERE id=${row.id}::uuid`;
    const before = inbox.length;
    await page.getByRole('button', { name: 'Send a new code' }).click();
    await page.getByRole('status').filter({ hasText: 'A new code has been sent' }).waitFor();
    assert.equal(inbox.length, before + 1);
    await verifyLatest(page);
    await heading(page, 'Review your invitation');
    assert(await page.getByRole('button', { name: 'Accept staff invitation' }).isDisabled());
    await page.screenshot({ path: join(evidence, 'staff-enrollment-desktop.png') });
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Accept staff invitation' }).evaluate((button) => {
      button.click();
      button.click();
    });
    await heading(page, 'You’re signed in');
    assert.equal(await db.staffPrincipal.count(), 1);
    assert.equal(await db.staffAudit.count({ where: { action: 'staff.invitation.accepted' } }), 1);
    assert(!(await page.evaluate(() => globalThis.document.cookie)).includes('darve_staff_dev_'));
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  });
  let ownerSecret = await staffSecret(owner);
  await check('canonical-reload-and-step-up-session-rotation', async () => {
    await page.reload();
    await heading(page, 'You’re signed in');
    const old = ownerSecret;
    await page.getByRole('button', { name: 'Verify identity again' }).click();
    await approveIdentity(page);
    await verifyLatest(page);
    await heading(page, 'You’re signed in');
    ownerSecret = await staffSecret(owner);
    assert.notEqual(ownerSecret, old);
    assert.equal(
      (await db.staffSession.findUniqueOrThrow({ where: { secretHash: crypto.hash(old) } }))
        .revoked,
      true,
    );
    const stale = await owner.request.get(api + '/admin/v1/session', {
      headers: { Cookie: 'darve_staff_dev_session=' + old },
    });
    assert.equal(stale.status(), 401);
  });
  const support = await browser.newContext({ ...devices['Pixel 7'] });
  observe(support);
  const phone = await support.newPage();
  subject = 'controlled-support';
  const supportInvitation = await service.invite(
    ownerSecret,
    crypto.csrf(ownerSecret),
    randomUUID(),
    { subject, role: 'SUPPORT', reason: 'F08 controlled Support browser' },
  );
  await check('support-mobile-enrollment-and-server-role-denial', async () => {
    await phone.goto(supportInvitation.acceptanceUrl);
    await phone.getByRole('button', { name: 'Continue to staff sign-in' }).click();
    await approveIdentity(phone);
    await phone.screenshot({ path: join(evidence, 'staff-code-mobile.png') });
    await verifyLatest(phone);
    await heading(phone, 'Review your invitation');
    await phone.getByRole('checkbox').check();
    await phone.getByRole('button', { name: 'Accept staff invitation' }).click();
    await heading(phone, 'You’re signed in');
    const secret = await staffSecret(support);
    const view = await service.session(secret, null);
    assert.equal(view.staff.role, 'SUPPORT');
    assert.equal((await support.request.get(api + '/admin/v1/staff')).status(), 403);
    assert(
      await phone.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.window.innerWidth,
      ),
    );
    await phone.screenshot({ path: join(evidence, 'staff-signed-in-mobile.png') });
    await service.changeMember(
      ownerSecret,
      crypto.csrf(ownerSecret),
      view.staff.id,
      view.staff.revision,
      { revoke: true },
      randomUUID(),
      'F08 controlled revocation',
    );
    await phone.getByRole('button', { name: 'Check staff access' }).click();
    await heading(phone, 'Sign in to Darve staff');
  });
  await check('lost-logout-response-held-closed-and-deliberate-retry', async () => {
    await page.bringToFront();
    await heading(page, 'You’re signed in');
    let abort = true;
    await page.route(api + '/admin/v1/session/logout', async (route) => {
      if (abort) {
        abort = false;
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await heading(page, 'Sign-out isn’t confirmed');
    await page.reload();
    await heading(page, 'Sign-out isn’t confirmed');
    await page.getByRole('button', { name: 'Check staff access' }).click();
    await heading(page, 'Sign-out isn’t confirmed');
    await page.getByRole('button', { name: 'Retry sign-out' }).click();
    await heading(page, 'Sign in to Darve staff');
    assert.equal(
      (await db.staffSession.findUniqueOrThrow({ where: { secretHash: crypto.hash(ownerSecret) } }))
        .revoked,
      true,
    );
  });
  subject = 'controlled-owner';
  await check('fresh-login-idle-expiry-and-private-state-clear', async () => {
    await page.getByRole('button', { name: 'Continue to staff sign-in' }).click();
    await approveIdentity(page);
    await verifyLatest(page);
    await heading(page, 'You’re signed in');
    ownerSecret = await staffSecret(owner);
    await db.$executeRaw`UPDATE staff_sessions SET "idleUntil"=clock_timestamp()-interval '1 millisecond' WHERE "secretHash"=${crypto.hash(ownerSecret)}`;
    await page.getByRole('button', { name: 'Verify identity again' }).click();
    await heading(page, 'Sign in to Darve staff');
    assert.equal(await page.getByText('Owner administrator', { exact: true }).count(), 0);
    assert.equal(network.creatorCookieSeen, false);
    assert.equal(network.staffCookieSeen, true);
    assert.equal(network.privateReferrerSeen, false);
    assert(
      network.mutations.every((path) =>
        /^\/admin\/v1\/(?:auth\/|invitations\/accept$|session\/logout$)/.test(path),
      ),
    );
  });
  assert.deepEqual(fingerprintSource(), sourceInputs);
  writeFileSync(
    join(evidence, 'actual-proof.json'),
    JSON.stringify(
      {
        runId,
        backendRevision: manifest.sourceRevision,
        publicConfiguration: {
          appEnv: 'local',
          apiOrigin: api,
          authorizationEndpoint,
          frontendOrigin: front,
        },
        frontendHead: run('git', ['rev-parse', 'HEAD']),
        sourceDirty: Boolean(run('git', ['status', '--porcelain'])),
        sourceInputs,
        sourceInputsUnchangedDuringQualification: true,
        controlledIdentityPort: true,
        realLoopbackMailAdapter: true,
        realConstrainedSqlAndRedis: true,
        noExternalProviderOrResendClaim: true,
        separateBuildModuleCount: modules.size,
        excludedCreatorFeatureImports: true,
        checks,
        privacy: {
          creatorCookieSeen: network.creatorCookieSeen,
          staffCookieSeen: network.staffCookieSeen,
          privateReferrerSeen: network.privateReferrerSeen,
        },
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  process.exitCode = 1;
  writeFileSync(
    join(evidence, 'failure.json'),
    JSON.stringify(
      {
        runId,
        check: current,
        detail,
        pagePath: observedPage ? new URL(observedPage.url()).pathname : null,
        apiStatuses: network.statuses,
        errorType: error.name,
        passedChecks: checks.map((value) => value.name),
      },
      null,
      2,
    ),
  );
  console.error(
    'Controlled staff acceptance failed at: ' +
      current +
      '. Private URLs, codes and payloads are omitted.',
  );
} finally {
  await browser?.close();
  if (site) await closeServer(site.httpServer);
  await Promise.all([closeServer(apiServer), closeServer(providerServer), closeServer(mailServer)]);
  await Promise.allSettled([admin?.$disconnect(), db?.$disconnect(), redis?.quit()]);
  let cleanup = true;
  for (const name of names) {
    try {
      const owner = run('docker', [
        'inspect',
        '--format',
        '{{index .Config.Labels "darve.frontend.run"}}',
        name,
      ]);
      assert.equal(owner, runId);
      run('docker', ['rm', '--force', name]);
    } catch {
      cleanup = false;
    }
  }
  writeFileSync(
    join(evidence, 'cleanup.json'),
    JSON.stringify(
      {
        runId,
        ownedContainersRemoved: cleanup,
        browserClosed: true,
        ownedServersClosed: true,
        clientsClosed: true,
      },
      null,
      2,
    ),
  );
  if (!cleanup) {
    process.exitCode = 1;
    console.error('Owned staff fixture cleanup requires inspection of its recorded run labels.');
  }
}
