import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { build, preview } from 'vite';
import { chromium, devices, expect } from '@playwright/test';
import { startLocalApi } from './local-api.mjs';

const evidence = resolve('artifacts.local/f08-04');
mkdirSync(evidence, { recursive: true });
const output = resolve(evidence, 'runtime-build');
assert(output.startsWith(evidence + sep) && output !== evidence);
const fingerprint = () => {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8', windowsHide: true },
  )
    .split('\0')
    .filter(
      (file) =>
        file &&
        ((file.startsWith('src/') &&
          !/\.(?:test|test-helper|test-support)\./.test(file) &&
          !file.startsWith('src/app/preview/')) ||
          file.startsWith('public/') ||
          /^(?:index\.html|overlay\.html|vite\.config\.ts|package(?:-lock)?\.json|tsconfig[^/]*\.json|tools\/local-(?:api|support-(?:acceptance|fixture))\.mjs)$/.test(
            file,
          )),
    );
  return Object.fromEntries(
    [...new Set(files)]
      .sort()
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  );
};
const sourceInputs = fingerprint(),
  checks = [],
  network = { posts: [], eventConnections: 0, referrerSeen: false };
const origin = 'http://127.0.0.1:4175';
const statuses = [];
let api,
  site,
  browser,
  current = 'setup',
  observed;
const check = async (name, action) => {
  current = name;
  const started = performance.now();
  await action();
  checks.push({ name, passed: true, durationMs: Math.round(performance.now() - started) });
  console.log(JSON.stringify({ check: name, passed: true }));
};
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    origins: [origin],
    task: 'f08-04',
    support: true,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  await build({
    configFile: 'vite.config.ts',
    mode: 'acceptance-support',
    envDir: false,
    logLevel: 'silent',
    build: { outDir: output, emptyOutDir: true },
  });
  site = await preview({
    configFile: 'vite.config.ts',
    mode: 'acceptance-support',
    envDir: false,
    logLevel: 'silent',
    build: { outDir: output },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 600_000 });
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  observed = page;
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === api.apiOrigin)
      statuses.push({ path: url.pathname, status: response.status() });
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== api.apiOrigin) return;
    if (url.pathname.endsWith('/events')) network.eventConnections++;
    network.referrerSeen ||= Boolean(request.headers().referer);
    if (request.method() === 'POST')
      network.posts.push({ path: url.pathname, key: request.headers()['idempotency-key'] ?? null });
  });
  const session = await (
    await context.request.get(api.apiOrigin + '/api/session', { headers: { Origin: origin } })
  ).json();
  assert.equal(session.authenticated, true);
  assert.equal(session.user.termsStatus.status, 'unconfigured');
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrfToken };
  const get = async (path) => {
    const response = await context.request.get(api.apiOrigin + path, { headers });
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  const post = (path, body, extra = {}) =>
    context.request.post(api.apiOrigin + path, {
      headers: { ...headers, 'Idempotency-Key': randomUUID(), ...extra },
      data: body,
    });
  let id;
  await check(
    'production creator entry creates and reloads a persisted ticket without terms admission',
    async () => {
      await page.goto(origin + '/support');
      await expect(
        page.getByRole('heading', { name: 'No conversations on this page' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'New ticket', exact: true }).click();
      await page
        .getByLabel('Message (required)', { exact: true })
        .fill('Synthetic local support question.');
      assert.equal(network.posts.length, 0);
      await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
      await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/i);
      await expect(
        page.getByText('Synthetic local support question.', { exact: true }),
      ).toBeVisible();
      id = new URL(page.url()).pathname.split('/').at(-1);
      assert.match(id, /^[0-9a-f-]{36}$/i);
      assert.equal((await api.supportFixture.counts(id)).messages, 1);
      await page.reload();
      await expect(
        page.getByText('Synthetic local support question.', { exact: true }),
      ).toBeVisible();
    },
  );
  await check(
    'actual support SSE reconciles a staff reply and excludes private notes at SQL and wire boundaries',
    async () => {
      await api.supportFixture.staffReply(id, 'Synthetic actual staff response.');
      await expect(
        page.getByText('Synthetic actual staff response.', { exact: true }),
      ).toBeVisible();
      const before = await get('/api/support/tickets/' + id);
      await api.supportFixture.note(id, 'Private synthetic staff note.');
      const after = await get('/api/support/tickets/' + id);
      assert.deepEqual(before, after);
      await api.supportFixture.assertPrivateIsolation(id);
      await expect(page.getByText('Private synthetic staff note.', { exact: true })).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Mark displayed messages as read', exact: true })
        .click();
      await expect(
        page.getByText('Displayed messages are marked as read.', { exact: true }),
      ).toBeVisible();
      assert.equal((await get('/api/support/tickets/' + id)).readSequence, 2);
    },
  );
  await check(
    'lost executed reply retains exact key/body and explicit retry inserts only one message',
    async () => {
      let held = false;
      const requests = [];
      await page.route(
        api.apiOrigin + '/api/support/tickets/' + id + '/messages',
        async (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          requests.push({
            key: route.request().headers()['idempotency-key'],
            body: route.request().postData(),
          });
          if (!held) {
            held = true;
            const response = await route.fetch();
            assert.equal(response.status(), 200);
            await route.abort();
          } else await route.continue();
        },
      );
      await page
        .getByLabel('Your reply (required)', { exact: true })
        .fill('Exactly one uncertain reply.');
      await page.getByRole('button', { name: 'Send reply', exact: true }).click();
      await expect(page.getByText(/The result is unconfirmed/)).toBeVisible();
      assert.equal(requests.length, 1);
      await page.getByRole('button', { name: 'Retry same support request', exact: true }).click();
      await expect(page.getByText('Exactly one uncertain reply.', { exact: true })).toBeVisible();
      await expect(page.getByText(/The result is unconfirmed/)).toHaveCount(0);
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      assert.equal((await api.supportFixture.counts(id)).messages, 3);
      await page.unroute(api.apiOrigin + '/api/support/tickets/' + id + '/messages');
    },
  );
  await check(
    'creator reply reopens the same resolved conversation and resync clears stale drafts',
    async () => {
      await api.supportFixture.resolve(id);
      await expect(
        page.getByRole('heading', { name: 'Reopen this conversation', exact: true }),
      ).toBeVisible();
      await page
        .getByLabel('Your reply (required)', { exact: true })
        .fill('Reopen my existing ticket.');
      await page.getByRole('button', { name: 'Send reply and reopen ticket', exact: true }).click();
      await expect(
        page.locator('.support-messages').getByText('Reopen my existing ticket.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Context type', { exact: true })).toBeEnabled();
      assert.equal((await get('/api/support/tickets/' + id)).status, 'open');
      assert.equal(new URL(page.url()).pathname, '/support/' + id);
    },
  );
  await check(
    'owned ended-broadcast context add/revoke and foreign resource/CSRF denial preserve scope',
    async () => {
      const owned = await api.supportFixture.seedBroadcast(creator.userId);
      await page.getByLabel('Context type', { exact: true }).selectOption('broadcast');
      await page.getByLabel('Resource ID (required)', { exact: true }).fill(owned);
      await page
        .getByLabel('Reason for context change (required)', { exact: true })
        .fill('Related ended stream.');
      await page.getByRole('button', { name: 'Add context', exact: true }).click();
      await expect(page.getByText(owned, { exact: true })).toBeVisible();
      const other = await api.seedSession(),
        foreign = await api.supportFixture.seedBroadcast(other.userId);
      const t = await get('/api/support/tickets/' + id);
      const denied = await post('/api/support/tickets/' + id + '/context-links', {
        context: { kind: 'broadcast', id: foreign },
        operation: 'add',
        reason: 'Synthetic forbidden probe',
        expectedContextRevision: t.contextRevision,
      });
      assert.equal(denied.status(), 404);
      const badCsrf = await post(
        '/api/support/tickets/' + id + '/messages',
        { body: 'Denied CSRF probe', expectedRevision: t.revision },
        { 'X-CSRF-Token': 'invalid' },
      );
      assert.equal(badCsrf.status(), 403);
      await page.getByRole('button', { name: 'Prepare removal', exact: true }).click();
      await page
        .getByLabel('Reason for context change (required)', { exact: true })
        .fill('Remove no-longer-needed context.');
      await page.getByRole('button', { name: 'Confirm context removal', exact: true }).click();
      await expect(page.getByText('No context attached.', { exact: true })).toBeVisible();
    },
  );
  await check(
    'real encrypted message pagination and canonical reload retain one conversation',
    async () => {
      for (let n = 0; n < 19; n++)
        await api.supportFixture.staffReply(id, 'Synthetic paginated response ' + n);
      await expect(page.getByRole('button', { name: 'Next messages', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Next messages', exact: true }).click();
      await expect(
        page.getByText('Synthetic paginated response 18', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Previous messages', exact: true }).click();
      await expect(
        page.getByText('Synthetic local support question.', { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: join(evidence, 'support-thread-desktop.png'), fullPage: true });
    },
  );
  await check(
    'actual socket interruption reconnects without replay IDs or commands and clears stale drafts',
    async () => {
      await expect(
        page.getByText('Connected to conversation updates', { exact: true }),
      ).toBeVisible();
      const before = network.eventConnections,
        posts = network.posts.length;
      await page
        .getByLabel('Your reply (required)', { exact: true })
        .fill('Synthetic disconnect draft.');
      api.interruptConnections();
      await expect.poll(() => network.eventConnections).toBeGreaterThan(before);
      await expect(
        page.getByText('Connected to conversation updates', { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Your reply (required)', { exact: true })).toHaveValue('');
      assert.equal(network.posts.length, posts);
    },
  );
  await check(
    'banned creator retains support access without granting business admission',
    async () => {
      await api.supportFixture.ban(creator.userId);
      await page.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
      await expect(
        page
          .locator('.support-messages')
          .getByText('Synthetic local support question.', { exact: true }),
      ).toBeVisible();
      assert.equal((await get('/api/support/tickets/' + id)).id, id);
    },
  );
  await check(
    'actual owned ticket pagination preserves opaque cursor and disjoint pages',
    async () => {
      for (let index = 0; index < 21; index++) {
        const response = await post('/api/support/tickets', {
          category: 'account',
          body: 'Synthetic pagination ticket ' + index,
          contexts: [],
        });
        assert.equal(response.status(), 200);
      }
      const first = await get('/api/support/tickets?limit=20');
      assert.equal(first.items.length, 20);
      assert(first.nextCursor);
      const second = await get(
        '/api/support/tickets?limit=20&cursor=' + encodeURIComponent(first.nextCursor),
      );
      assert.equal(second.items.length, 2);
      assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 22);
      await page.goto(origin + '/support');
      await expect(page.getByRole('button', { name: 'Next tickets', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Next tickets', exact: true }).click();
      await expect(page.locator('.support-ticket')).toHaveCount(2);
      await page.getByRole('button', { name: 'Previous tickets', exact: true }).click();
      await expect(page.locator('.support-ticket')).toHaveCount(20);
      await page.goto(origin + '/support/' + id);
      await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
    },
  );
  await check(
    'retention redaction removes old text and mounted drafts through actual live resync',
    async () => {
      await page
        .getByLabel('Your reply (required)', { exact: true })
        .fill('Synthetic draft to clear.');
      await api.supportFixture.resolve(id);
      await expect(page.getByText('This message is no longer available.')).toHaveCount(20, {
        timeout: 10_000,
      });
      await expect(page.getByLabel('Your reply (required)', { exact: true })).toHaveValue('');
      await expect(
        page.getByText('Synthetic local support question.', { exact: true }),
      ).toHaveCount(0);
    },
  );
  await check(
    'fresh mobile creator cannot read another owner ticket and revoked authority clears private content',
    async () => {
      const mobile = await browser.newContext({ ...devices['Pixel 7'] });
      const second = await api.seedSession({ expiresInMs: 600_000 });
      await mobile.addCookies([
        {
          name: 'darve_session',
          value: second.secret,
          url: api.apiOrigin,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const phone = await mobile.newPage();
      observed = phone;
      await phone.goto(origin + '/support/' + id);
      await expect(
        phone.getByRole('heading', { name: 'Conversation unavailable', exact: true }),
      ).toBeVisible();
      await phone.goto(origin + '/support');
      await expect(
        phone.getByRole('heading', { name: 'No conversations on this page' }),
      ).toBeVisible();
      await phone.screenshot({ path: join(evidence, 'support-mobile.png'), fullPage: true });
      await api.supportFixture.revoke(creator.sessionId);
      observed = page;
      await page.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
      await expect(
        page.getByText('Your session expired. Sign in again to continue.', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('.support-messages')).toHaveCount(0);
      await mobile.close();
    },
  );
  assert.deepEqual(fingerprint(), sourceInputs);
  assert.equal(network.referrerSeen, false);
  writeFileSync(
    join(evidence, 'actual-proof.json'),
    JSON.stringify(
      {
        runId: api.runId,
        backend: api.source,
        frontendBase: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        sourceInputs,
        sourceUnchangedDuringRun: true,
        checks,
        restrictedPublicRole: true,
        privateNoteSqlIsolation: true,
        privateReferrerAbsent: true,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  process.exitCode = 1;
  const controlState =
    observed && !observed.isClosed()
      ? await observed
          .locator('button,input,select,textarea')
          .evaluateAll((elements) =>
            elements.map((element) => ({
              tag: element.tagName,
              label: element.getAttribute('aria-label'),
              text: element.tagName === 'BUTTON' ? element.textContent?.slice(0, 100) : null,
              disabled: element.hasAttribute('disabled'),
            })),
          )
          .catch(() => [])
      : [];
  await observed
    ?.screenshot({ path: join(evidence, 'synthetic-failure.png'), fullPage: true })
    .catch(() => {});
  writeFileSync(
    join(evidence, 'failure.json'),
    JSON.stringify(
      {
        runId: api?.runId ?? null,
        phase: current,
        errorType: error.name,
        matcher: error.matcherResult?.name ?? null,
        callsite:
          error.stack
            ?.split('\n')
            .find((line) => line.includes('local-support-acceptance.mjs:'))
            ?.trim() ?? null,
        statuses,
        controlState,
        pagePath: observed ? new URL(observed.url()).pathname : null,
        passed: checks.map((check) => check.name),
      },
      null,
      2,
    ),
  );
  console.error(
    'Support acceptance failed at ' + current + '. Private request bodies and proof are omitted.',
  );
} finally {
  await browser?.close();
  if (site)
    await new Promise((done) => {
      site.httpServer.close(done);
      site.httpServer.closeAllConnections();
    });
  await api?.close();
  writeFileSync(
    join(evidence, 'cleanup.json'),
    JSON.stringify(
      {
        runId: api?.runId ?? null,
        ownedBrowserClosed: true,
        ownedPreviewClosed: true,
        ownedApiAndLabelledStorageClosed: true,
      },
      null,
      2,
    ),
  );
}
