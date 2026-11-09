import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, preview } from 'vite';
import { chromium, devices, expect } from '@playwright/test';
import { startLocalApi } from './local-api.mjs';

// Production entries and real HTTP/domain/SQL/Redis. External identity/provider/model/money facts are synthetic.
const directory = resolve('artifacts.local/f10-02'),
  origin = 'http://127.0.0.1:4175';
mkdirSync(directory, { recursive: true });
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fingerprint = () =>
  Object.fromEntries(
    git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
      .split('\0')
      .filter(
        (file) =>
          file &&
          /^(src\/|public\/|tools\/|package(?:-lock)?\.json|vite\.|(?:index|overlay)\.html)/.test(
            file,
          ),
      )
      .sort()
      .map((file) => [file, hash(readFileSync(file))]),
  );
const sourceInputs = fingerprint(),
  source = git('rev-parse', 'HEAD'),
  dirty = Boolean(git('status', '--porcelain'));
const checks = [],
  errors = [],
  records = [],
  observed = { externalRequests: false };
let api,
  site,
  browser,
  page,
  result,
  phase = 'setup',
  failure,
  failureFile;
const check = async (name, action) => {
  phase = name;
  await action();
  checks.push(name);
  console.log('PASS ' + name);
};
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    task: 'f10-02',
    port: 3310,
    origins: [origin],
    collection: true,
    review: true,
    reporting: true,
    terms: true,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  const output = join(directory, 'public-build');
  await build({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'creator-lifecycle',
    logLevel: 'silent',
    build: { outDir: output, emptyOutDir: true },
  });
  site = await preview({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'creator-lifecycle',
    logLevel: 'silent',
    build: { outDir: output },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 1200000 });
  const newContext = async (identity, options = {}) => {
    const context = await browser.newContext(options);
    await context.addCookies([
      {
        name: 'darve_session',
        value: identity.secret,
        url: api.apiOrigin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.name)));
    context.on('request', (request) => {
      if (!['http:', 'https:'].includes(new URL(request.url()).protocol)) return;
      if (![origin, api.apiOrigin].includes(new URL(request.url()).origin))
        observed.externalRequests = true;
    });
    return context;
  };
  const context = await newContext(creator, { viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  await page.goto(origin + '/collection');
  await page.getByRole('checkbox', { name: /I have read and accept account terms/ }).check();
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start collection', exact: true })).toBeVisible();
  const session = await (
    await context.request.get(api.apiOrigin + '/api/session', { headers: { Origin: origin } })
  ).json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrfToken };
  const get = async (path) => {
    const response = await context.request.get(api.apiOrigin + path, { headers });
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  const declarationBody = (detail) => ({
    expectedVersion: detail.performance.revision,
    termsVersion: detail.terms.version,
    ...(detail.performanceAuthority
      ? { expectedPerformanceRevision: detail.performanceAuthority.revision }
      : {}),
  });
  await check(
    'current creator terms and empty dashboard use the actual production entry and API',
    async () => {
      await page.goto(origin + '/dashboard?timeZone=UTC');
      await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
      const summary = await get('/api/dashboard/summary?timeZone=UTC');
      assert.equal(summary.history.acceptedChallenges, 0);
      assert.deepEqual(summary.history.contributionsByCurrency, []);
    },
  );
  api.collectionFixture.capacity('available');
  for (const [provider, label, currency, decimal, amountMinor] of [
    ['TWITCH', 'Twitch', 'EUR', '25.50', '2550'],
    ['YOUTUBE', 'YouTube', 'USD', '10.07', '1007'],
    ['KICK', 'Kick', 'EUR', '12.00', '1200'],
  ]) {
    const stream = await api.collectionFixture.seed(creator.userId, provider);
    let roundId, item, suggestions, acceptedId;
    await check(
      provider + ' Start, known-round reload, admitted ideas and Stop freeze one snapshot',
      async () => {
        await page.goto(origin + '/collection');
        await page.getByRole('radio', { name: label, exact: true }).check();
        await page
          .getByRole('combobox', { name: /Connected account/ })
          .selectOption(stream.connectionId);
        await expect(
          page.getByRole('button', { name: 'Start collection', exact: true }),
        ).toBeEnabled();
        await page.getByLabel('Collection duration').fill('60');
        if (provider === 'TWITCH') {
          const attempts = [];
          let drop = true;
          await page.route(api.apiOrigin + '/api/rounds', async (route) => {
            const request = route.request();
            if (request.method() === 'POST') {
              attempts.push({
                key: request.headers()['idempotency-key'],
                body: request.postData(),
              });
              if (drop) {
                drop = false;
                assert.equal((await route.fetch()).status(), 202);
                await route.abort('failed');
                return;
              }
            }
            await route.continue();
          });
          await page.getByRole('button', { name: 'Start collection', exact: true }).click();
          const retry = page.getByRole('button', {
            name: 'Retry the same Start request',
            exact: true,
          });
          await expect(retry).toBeVisible();
          await page.waitForTimeout(800);
          assert.equal(attempts.length, 1);
          assert.equal(await api.collectionFixture.roundCount(creator.userId), 1);
          await retry.click();
          await expect(
            page.getByRole('heading', { name: 'Preparing your collection', exact: true }),
          ).toBeVisible();
          assert.equal(attempts.length, 2);
          assert.deepEqual(attempts[0], attempts[1]);
          await page.unroute(api.apiOrigin + '/api/rounds');
        } else {
          await page.getByRole('button', { name: 'Start collection', exact: true }).click();
          await expect(
            page.getByRole('heading', { name: 'Preparing your collection', exact: true }),
          ).toBeVisible();
        }
        roundId = new URL(page.url()).pathname.split('/').at(-1);
        await api.collectionFixture.recover();
        await expect(
          page.getByRole('heading', { name: 'Collecting viewer ideas', exact: true }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByRole('heading', { name: 'Collecting viewer ideas', exact: true }),
        ).toBeVisible();
        const round = await get('/api/rounds/' + roundId);
        assert.equal(round.broadcastId, stream.broadcastId);
        assert.equal(round.connectionId, stream.connectionId);
        const competing = await context.request.post(api.apiOrigin + '/api/rounds', {
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          data: { ...stream, collectionDurationSeconds: 60, announcementPinMode: 'off' },
        });
        assert.equal(competing.status(), 409);
        assert.equal((await competing.json()).error.code, 'COLLECTION_ALREADY_ACTIVE');
        await api.collectionFixture.admitIdeas(creator.userId, roundId);
        await page.getByRole('button', { name: 'Stop collection', exact: true }).click();
        await page.getByRole('button', { name: 'Confirm stop', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Collection ended', exact: true }),
        ).toBeVisible();
        const closed = await api.collectionFixture.roundState(roundId);
        assert.equal(closed.state, 'closed');
        assert.equal(closed.snapshotCount, 1);
      },
    );
    await check(
      provider +
        ' actual analysis and grouped review retain all sources and duplicate-name credits',
      async () => {
        await page.getByRole('link', { name: 'Review viewer ideas', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Review viewer ideas', exact: true }),
        ).toBeVisible();
        await api.reviewFixture.publish(creator.userId, roundId);
        await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
        await expect(page.getByRole('article')).toHaveCount(2);
        suggestions = await get(`/api/rounds/${roundId}/suggestions`);
        assert.equal(suggestions.totalSafeCount, 2);
        assert.equal(
          suggestions.items.reduce((count, idea) => count + idea.sourceSubmissionIds.length, 0),
          3,
        );
        const grouped = suggestions.items.find((idea) => idea.authors.length === 2);
        assert.ok(grouped);
        assert.equal(grouped.authors[0].displayName, grouped.authors[1].displayName);
        assert.notEqual(grouped.authors[0].providerAuthorId, grouped.authors[1].providerAuthorId);
        await page.getByRole('button', { name: 'Pin idea 1', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Unpin idea 1', exact: true })).toBeEnabled();
        suggestions = await get(`/api/rounds/${roundId}/suggestions`);
        item = suggestions.items[0];
        assert.equal(item.version, 2);
        assert.equal(item.pinned, true);
      },
    );
    await check(
      provider +
        ' reviewed acceptance preserves exact terms, current versions and once-only commitment',
      async () => {
        const endpoint = `${api.apiOrigin}/api/rounds/${roundId}/suggestions/${item.id}/accept`;
        const input = {
          expectedVersion: item.version,
          analysisRunId: item.analysisRunId,
          resultVersion: suggestions.resultVersion,
          snapshotVersion: item.snapshotVersion,
          goal: { amountMinor, currency },
          fundingDurationSeconds: 600,
        };
        for (const [body, csrf, status] of [
          [input, 'wrong', 403],
          [{ ...input, expectedVersion: 1 }, headers['X-CSRF-Token'], 409],
        ]) {
          const response = await context.request.post(endpoint, {
            headers: { ...headers, 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID() },
            data: body,
          });
          assert.equal(response.status(), status);
        }
        const openReview = async () => {
          await page.getByRole('button', { name: 'Accept idea 1', exact: true }).click();
          await page.getByLabel('Funding goal', { exact: true }).fill(decimal);
          await page.getByRole('combobox', { name: /Currency/ }).selectOption(currency);
          await page.getByLabel('Funding duration in seconds', { exact: true }).fill('600');
          await page.getByRole('button', { name: 'Review exact terms', exact: true }).click();
        };
        if (provider !== 'TWITCH') {
          const before = await api.reviewFixture.counts(creator.userId);
          if (provider === 'YOUTUBE') api.collectionFixture.funding('not_ready');
          else api.collectionFixture.streamChanged(true);
          await openReview();
          await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
          await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
          assert.deepEqual(await api.reviewFixture.counts(creator.userId), before);
          await page.getByRole('button', { name: 'Back to review', exact: true }).click();
          api.collectionFixture.funding('ready');
          api.collectionFixture.streamChanged(false);
          await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
        }
        const attempts = [];
        let drop = provider === 'TWITCH';
        await page.route(endpoint, async (route) => {
          attempts.push({
            key: route.request().headers()['idempotency-key'],
            body: route.request().postData(),
          });
          if (drop) {
            drop = false;
            assert.equal((await route.fetch()).status(), 201);
            await route.abort('failed');
            return;
          }
          await route.continue();
        });
        await openReview();
        await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
        if (provider === 'TWITCH') {
          const retry = page.getByRole('button', { name: 'Retry same acceptance', exact: true });
          await expect(retry).toBeVisible();
          await page.waitForTimeout(800);
          assert.equal(attempts.length, 1);
          assert.deepEqual(await api.reviewFixture.counts(creator.userId), {
            challenges: 1,
            receipts: 1,
          });
          await retry.click();
        }
        await expect(
          page.getByRole('heading', { name: 'Accepted challenge', exact: true }),
        ).toBeVisible();
        if (provider === 'TWITCH') {
          assert.equal(attempts.length, 2);
          assert.deepEqual(attempts[0], attempts[1]);
        }
        assert.ok(attempts[0].key);
        assert.deepEqual(JSON.parse(attempts[0].body), input);
        await page.unroute(endpoint);
        const projection = await get(`/api/rounds/${roundId}/suggestions`);
        acceptedId = projection.items.find((idea) => idea.id === item.id).selectedChallengeId;
        assert.ok(acceptedId);
        const detail = await get('/api/challenges/' + acceptedId);
        assert.deepEqual(detail.terms.goal, { amountMinor, currency });
        assert.equal(detail.roundId, roundId);
        assert.equal(detail.terms.fundingDurationSeconds, 600);
        const conflict = await context.request.post(endpoint, {
          headers: { ...headers, 'Idempotency-Key': attempts[0].key },
          data: { ...input, fundingDurationSeconds: 601 },
        });
        assert.equal(conflict.status(), 409);
        await page.reload();
        await expect(
          page.getByRole('button', { name: 'View accepted challenge', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Accept idea 2', exact: true }),
        ).toBeDisabled();
      },
    );
    await check(
      provider +
        ' retained challenge and round analytics agree while unfunded completion is denied',
      async () => {
        await page.goto(origin + '/challenges/' + acceptedId);
        await expect(
          page.getByRole('heading', { name: 'Challenge details', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Declare completion', exact: true }),
        ).toHaveCount(0);
        const detail = await get('/api/challenges/' + acceptedId);
        assert.equal(detail.funding.confirmedGross, '0');
        const denied = await context.request.post(
          `${api.apiOrigin}/api/challenges/${acceptedId}/completion-declarations`,
          {
            headers: { ...headers, 'Idempotency-Key': randomUUID() },
            data: declarationBody(detail),
          },
        );
        assert.equal(denied.status(), 409);
        assert.equal((await denied.json()).error.code, 'NOT_FUNDED');
        assert.equal(await api.reportingFixture.declarationCount(creator.userId), 0);
        await page.getByRole('link', { name: 'View round analytics', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Round analytics', exact: true }),
        ).toBeVisible();
        const analytics = await get(`/api/rounds/${roundId}/analytics`);
        assert.equal(analytics.roundId, roundId);
        assert.equal(analytics.eligibleSubmissions.value, 3);
        assert.equal(analytics.financial.challengeId, acceptedId);
        assert.equal(analytics.financial.scope, 'accepted_challenge_lifetime');
        records.push({ provider, roundId, challengeId: acceptedId, ...stream });
      },
    );
  }
  await check(
    'retained history and dashboard keep three overlapping provider challenges with no invented money',
    async () => {
      assert.deepEqual(await api.reviewFixture.counts(creator.userId), {
        challenges: 3,
        receipts: 3,
      });
      assert.equal(await api.collectionFixture.roundCount(creator.userId), 3);
      const summary = await get('/api/dashboard/summary?timeZone=UTC');
      assert.equal(summary.history.acceptedChallenges, 3);
      assert.equal(summary.history.historicallyFundedChallenges, 0);
      assert.deepEqual(summary.history.contributionsByCurrency, []);
      await page.goto(origin + '/challenges');
      await expect(page.getByRole('article')).toHaveCount(3);
      for (const record of records)
        await expect(
          page
            .getByRole('link', { name: 'View challenge', exact: true })
            .and(page.locator(`a[href="/challenges/${record.challengeId}"]`)),
        ).toBeVisible();
      const first = await get('/api/challenges?limit=1'),
        rest = await get('/api/challenges?limit=50&cursor=' + encodeURIComponent(first.nextCursor));
      assert.ok(first.nextCursor);
      assert.equal(new Set([...first.items, ...rest.items].map((item) => item.id)).size, 3);
    },
  );
  await check(
    'explicit synthetic financial prerequisites enable manual declaration without claiming a real payment',
    async () => {
      await api.reportingFixture.fund(records[0].challengeId);
      await api.reportingFixture.fund(records[1].challengeId);
      const endpoint = `${api.apiOrigin}/api/challenges/${records[0].challengeId}/completion-declarations`;
      await page.goto(origin + '/challenges/' + records[0].challengeId);
      await expect(
        page.getByRole('button', { name: 'Declare completion', exact: true }),
      ).toBeVisible();
      assert.equal(await api.reportingFixture.declarationCount(creator.userId), 0);
      const detail = await get('/api/challenges/' + records[0].challengeId),
        body = declarationBody(detail);
      assert.equal(detail.funding.state, 'funded');
      assert.equal(detail.performance.state, 'awaiting_performance');
      api.collectionFixture.streamChanged(true);
      const wrongStream = await context.request.post(endpoint, {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: body,
      });
      assert.equal(wrongStream.status(), 409);
      assert.equal((await wrongStream.json()).error.code, 'CONTEXT_CHANGED');
      api.collectionFixture.streamChanged(false);
      const wrongCsrf = await context.request.post(endpoint, {
        headers: { ...headers, 'X-CSRF-Token': 'wrong', 'Idempotency-Key': randomUUID() },
        data: body,
      });
      assert.equal(wrongCsrf.status(), 403);
      let sent;
      const observe = (request) => {
        if (request.url() === endpoint && request.method() === 'POST')
          sent = { key: request.headers()['idempotency-key'], body: request.postDataJSON() };
      };
      page.on('request', observe);
      await page.getByRole('button', { name: 'Declare completion', exact: true }).click();
      const consent = page.getByRole('checkbox', {
        name: 'I confirm I completed this challenge on its original or authorized stream.',
        exact: true,
      });
      await expect(consent).not.toBeChecked();
      await expect(
        page.getByRole('button', { name: 'Confirm completion declaration', exact: true }),
      ).toBeDisabled();
      await consent.check();
      await page
        .getByRole('button', { name: 'Confirm completion declaration', exact: true })
        .click();
      await expect(
        page.getByText('Your completion declaration was recorded', { exact: false }),
      ).toBeVisible();
      page.off('request', observe);
      assert.ok(sent);
      assert.deepEqual(sent.body, body);
      const replay = await context.request.post(endpoint, {
        headers: { ...headers, 'Idempotency-Key': sent.key },
        data: sent.body,
      });
      assert.equal(replay.status(), 200);
      assert.equal(await api.reportingFixture.declarationCount(creator.userId), 1);
      const declared = await get('/api/challenges/' + records[0].challengeId);
      assert.deepEqual(declared.terms, detail.terms);
      assert.equal(declared.performance.state, 'declared_complete');
      assert.equal(declared.performance.verification, 'streamer_declaration');
      await page.reload();
      await expect(page.getByText('Streamer declared complete', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Declare completion', exact: true }),
      ).toHaveCount(0);
    },
  );
  await check(
    'declaration reconciles history and dashboard with exact separate currencies and civil-time filters',
    async () => {
      const summary = await get('/api/dashboard/summary?timeZone=UTC');
      assert.equal(summary.history.acceptedChallenges, 3);
      assert.equal(summary.history.historicallyFundedChallenges, 2);
      assert.equal(summary.history.streamerDeclaredCompletions, 1);
      assert.deepEqual(
        summary.history.contributionsByCurrency.map((row) => [
          row.currency,
          row.grossContributions,
        ]),
        [
          ['EUR', '2550'],
          ['USD', '1007'],
        ],
      );
      await page.goto(origin + '/challenges');
      await expect(
        page.getByRole('heading', { name: 'Challenge history', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('combobox', { name: /Filter loaded challenges/ })
        .selectOption('declared');
      await expect(page.getByRole('article')).toHaveCount(1);
      await page.reload();
      await expect(page.getByRole('article')).toHaveCount(1);
      await page.goto(origin + '/dashboard?timeZone=UTC');
      await page.getByLabel('Reporting timezone', { exact: true }).fill('Europe/Warsaw');
      await page.getByLabel('From date', { exact: true }).fill('2026-03-29');
      await page.getByLabel('Through date', { exact: true }).fill('2026-03-29');
      await page.getByRole('button', { name: 'Apply reporting filters', exact: true }).click();
      await expect(page).toHaveURL(/timeZone=Europe%2FWarsaw/);
      await expect(page.getByText('Server interval:', { exact: false })).toContainText(
        '2026-03-28T23:00:00.000Z inclusive to 2026-03-29T22:00:00.000Z exclusive',
      );
    },
  );
  await check(
    'fresh mobile browser retains the same known round and canonical declaration',
    async () => {
      const mobile = await newContext(creator, devices['Pixel 7']),
        mobilePage = await mobile.newPage();
      await mobilePage.goto(origin + '/collection/' + records[2].roundId);
      await expect(
        mobilePage.getByRole('heading', { name: 'Collection ended', exact: true }),
      ).toBeVisible();
      await mobilePage.goto(origin + '/challenges/' + records[0].challengeId);
      await expect(
        mobilePage.getByText('Streamer declared complete', { exact: true }),
      ).toBeVisible();
      assert.equal(
        await mobilePage.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
        true,
      );
      await mobile.close();
    },
  );
  await check(
    'foreign creator authority cannot read any lifecycle resource or reuse another owner history cursor',
    async () => {
      const other = await api.seedSession(),
        foreign = await newContext(other),
        cursor = (await get('/api/challenges?limit=1')).nextCursor;
      for (const record of records)
        for (const path of [
          '/api/rounds/' + record.roundId,
          `/api/rounds/${record.roundId}/suggestions`,
          `/api/rounds/${record.roundId}/analytics`,
          '/api/challenges/' + record.challengeId,
        ])
          assert.equal(
            (
              await foreign.request.get(api.apiOrigin + path, { headers: { Origin: origin } })
            ).status(),
            404,
          );
      assert.equal(
        (
          await foreign.request.get(
            api.apiOrigin + '/api/challenges?cursor=' + encodeURIComponent(cursor),
            { headers: { Origin: origin } },
          )
        ).status(),
        400,
      );
      await foreign.close();
    },
  );
  await check(
    'source restriction and sign-out remove private lifecycle views without losing retained declarations',
    async () => {
      await api.reviewFixture.restrict(records[0].roundId);
      await page.goto(origin + '/challenges/' + records[0].challengeId);
      await expect(
        page.getByRole('heading', { name: 'Challenge content unavailable', exact: true }),
      ).toBeVisible();
      assert.equal(await api.reportingFixture.declarationCount(creator.userId), 1);
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Connect your stream to Darve', exact: true }),
      ).toBeVisible();
      assert.equal(await api.revoked(creator.sessionId), true);
      assert.equal(
        (
          await context.request.get(api.apiOrigin + '/api/challenges/' + records[1].challengeId, {
            headers: { Origin: origin },
          })
        ).status(),
        401,
      );
      assert.deepEqual(
        await page.evaluate(() => [localStorage.length, sessionStorage.length]),
        [0, 0],
      );
    },
  );
  assert.deepEqual(errors, []);
  assert.equal(observed.externalRequests, false);
  assert.deepEqual(fingerprint(), sourceInputs);
  result = {
    frontend: source,
    dirtyAtStart: dirty,
    sourceInputs,
    backend: api.source,
    runId: api.runId,
    migrations: api.migrations,
    contractProvenanceSha256: hash(readFileSync('vendor/contracts/provenance.json')),
    checks,
    providerCoverage: records.map((record) => ({
      provider: record.provider,
      evidence: 'controlled_actual',
    })),
    productionBrowser: true,
    realPostgres: true,
    realRedis: true,
    actualProviderStorageAndAnalysisRepositories: true,
    controlledIdentityProviderModelReceivingAndFinancialFacts: true,
    syntheticFinancialPrerequisites: 2,
    genuineProviderOrPaymentCalls: false,
    newNativeOrPhoneObservation: false,
    liveStreamVerification: false,
    acceptedChallenges: 3,
    completionDeclarations: 1,
    unknownActiveRoundDiscoveryQualified: false,
    originalSourceUrlsQualified: false,
    pageErrors: errors,
    externalBrowserRequests: observed.externalRequests,
  };
} catch (error) {
  failure = error;
  failureFile = join(directory, 'failure-' + (api?.runId ?? randomUUID()) + '.json');
  writeFileSync(
    failureFile,
    JSON.stringify(
      {
        phase,
        errorName: error.name,
        assertionCode: error.code,
        syntheticUiHeadings: await page
          ?.getByRole('heading')
          .allTextContents()
          .catch(() => []),
        checks,
        cleanupComplete: false,
        callsite: error.stack
          ?.split('\n')
          .filter((line) =>
            /(?:local-creator-lifecycle-acceptance|local-provider-ideas-fixture|local-collection-fixture)\.mjs:\d/.test(
              line,
            ),
          )
          .slice(0, 3),
      },
      null,
      2,
    ),
  );
  console.error('FAIL ' + phase + ' (' + error.name + ')');
} finally {
  const cleanup = await Promise.allSettled([
    browser?.close(),
    site
      ? new Promise((done, reject) => {
          site.httpServer.closeAllConnections();
          site.httpServer.close((error) => (error ? reject(error) : done()));
        })
      : undefined,
  ]);
  try {
    await api?.close();
  } catch {
    cleanup.push({ status: 'rejected' });
  }
  const cleanupComplete = cleanup.every((item) => item.status === 'fulfilled');
  if (failureFile)
    writeFileSync(
      failureFile,
      JSON.stringify(
        {
          ...JSON.parse(readFileSync(failureFile, 'utf8')),
          cleanupComplete,
        },
        null,
        2,
      ),
    );
  writeFileSync(
    join(directory, 'cleanup.json'),
    JSON.stringify({ runId: api?.runId, cleanupComplete, at: new Date().toISOString() }, null, 2),
  );
  if (result && cleanupComplete) {
    writeFileSync(
      join(directory, 'acceptance.json'),
      JSON.stringify({ ...result, cleanupComplete }, null, 2),
    );
    console.log(
      JSON.stringify({
        checks: checks.length,
        providers: 3,
        acceptedChallenges: 3,
        declarations: 1,
        genuineExternalChecks: false,
        cleanupComplete,
      }),
    );
  } else process.exitCode = 1;
  if (failure || !cleanupComplete) process.exitCode = 1;
}
