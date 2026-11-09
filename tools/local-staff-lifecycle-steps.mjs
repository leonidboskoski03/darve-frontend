import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';

/** F10-04 only: product browser actions around controlled external facts, never seeded money/claims. */
export async function collectLifecycle({ api, creator, page, context, origin }) {
  context.setDefaultTimeout(12_000);
  const failures = [];
  page.on('response', async (response) => {
    if (response.status() >= 400 && response.url().startsWith(api.apiOrigin))
      failures.push([
        new URL(response.url()).pathname.replace(/[0-9a-f-]{36}/gi, ':resource'),
        response.status(),
        (await response.json().catch(() => ({}))).error?.code,
      ]);
  });
  await page.goto(origin + '/collection');
  await page.getByRole('checkbox', { name: /I have read and accept account terms/ }).check();
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start collection', exact: true }))
    .toBeVisible()
    .catch(() => {
      throw new Error('Collection after terms: ' + JSON.stringify(failures));
    });
  const session = await (await context.request.get(api.apiOrigin + '/api/session')).json();
  await api.checkoutFixture.configure(creator.userId, creator.secret, session.csrfToken);
  api.collectionFixture.capacity('available');
  const stream = await api.collectionFixture.seed(creator.userId);
  await page.reload();
  await page.getByRole('combobox', { name: 'Connected account' }).selectOption(stream.connectionId);
  await page.getByLabel('Collection duration').fill('60');
  await expect(page.getByRole('button', { name: 'Start collection', exact: true }))
    .toBeEnabled()
    .catch(async () => {
      throw new Error(
        'Collection readiness: ' +
          JSON.stringify({ failures, status: await page.getByRole('status').allTextContents() }),
      );
    });
  await page.getByRole('button', { name: 'Start collection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preparing your collection' })).toBeVisible();
  const roundId = new URL(page.url()).pathname.split('/').at(-1);
  await api.collectionFixture.recover();
  await expect(page.getByRole('heading', { name: 'Collecting viewer ideas' })).toBeVisible();
  await api.collectionFixture.admitIdeas(
    creator.userId,
    roundId,
    ['Draw a cat'],
    ['synthetic-lifecycle-viewer'],
  );
  await page.getByRole('button', { name: 'Stop collection', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm stop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Collection ended' }))
    .toBeVisible()
    .catch(() => {
      throw new Error('Collection Stop: ' + JSON.stringify(failures));
    });
  await api.reviewFixture.publish(creator.userId, roundId);
  await page.getByRole('link', { name: 'Review viewer ideas', exact: true }).click();
  await page.getByRole('button', { name: 'Accept idea 1', exact: true }).click();
  await page.getByLabel('Funding goal', { exact: true }).fill('10.00');
  await page.getByRole('combobox', { name: /Currency/ }).selectOption('EUR');
  await page.getByLabel('Funding duration in seconds', { exact: true }).fill('600');
  await page
    .getByRole('checkbox', { name: /I understand and accept this funding extension policy/ })
    .check();
  await page.getByRole('button', { name: 'Review exact terms', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
  const link = page.getByRole('link', { name: 'View challenge details and declaration' });
  const challengeId = (await link.getAttribute('href')).split('/').at(-1);
  const response = await context.request.get(api.apiOrigin + '/api/challenges/' + challengeId);
  assert.equal(response.status(), 200);
  const detail = (await response.json()).data;
  assert.equal(detail.roundId, roundId);
  assert.equal(detail.funding.eligibleGross, '0');
  return { roundId, challengeId, publicUrl: detail.contributionUrl, terms: detail.terms };
}

export async function attachLifecycle({ page, challenge }) {
  for (const [kind, id] of [
    ['round', challenge.roundId],
    ['challenge', challenge.challengeId],
  ]) {
    await page.getByLabel('Context type', { exact: true }).selectOption(kind);
    await page.getByLabel('Resource ID (required)', { exact: true }).fill(id);
    await page.getByLabel('Reason for context change').fill('Reviewed same lifecycle resource.');
    await page.getByRole('button', { name: 'Add context', exact: true }).click();
    await expect(page.locator('code').filter({ hasText: id })).toBeVisible();
  }
}

export async function recoverLifecycle({
  runtime,
  challenge,
  ticketId,
  ownerContext,
  ownerPage,
  support,
  supportContext,
  staffOrigin,
  adminOrigin,
  check,
}) {
  const path = '/admin/v1/support/tickets/' + ticketId;
  const recoveryPath = path + '/recovery/' + challenge.challengeId;
  const current = async () => {
    const response = await ownerContext.request.get(adminOrigin + recoveryPath);
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  const initial = await runtime.recoveryEvidence(challenge.challengeId);
  const extension = (c) => ({
    challengeId: c.challengeId,
    expectedTicketRevision: c.ticketRevision,
    expectedContextRevision: c.contextRevision,
    expectedAuthorityRevision: c.authorityRevision,
    expectedFundingRevision: c.fundingRevision,
    expectedPerformanceRevision: c.performanceRevision,
    expectedWindowRevision: c.fundingWindow.revision,
    addedSeconds: 60,
    reason: 'Reviewed interrupted synthetic lifecycle.',
    confirmation: {
      challengeId: c.challengeId,
      previousDeadline: c.fundingWindow.effectiveClosesAt,
      newDeadline: new Date(Date.parse(c.fundingWindow.effectiveClosesAt) + 60000).toISOString(),
    },
  });
  let reviewed;
  await check(
    'same-round ticket recovery rejects Support writes and foreign contexts; reviewed lost extension replays once',
    async () => {
      reviewed = extension(await current());
      assert.equal((await supportContext.request.get(adminOrigin + recoveryPath)).status(), 403);
      assert.equal(
        (await ownerContext.request.get(adminOrigin + path + '/recovery/' + randomUUID())).status(),
        404,
      );
      const denied = await supportContext.request.post(adminOrigin + path + '/extensions', {
        headers: {
          Origin: staffOrigin,
          'X-Staff-CSRF': support.csrf,
          'Idempotency-Key': randomUUID(),
        },
        data: reviewed,
      });
      assert.equal(denied.status(), 403);
      const writes = [];
      await ownerPage.route(adminOrigin + path + '/extensions', async (route) => {
        writes.push({
          key: route.request().headers()['idempotency-key'],
          body: route.request().postData(),
        });
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        if (writes.length === 1) await route.abort('failed');
        else await route.fulfill({ response });
      });
      await ownerPage.goto(staffOrigin + '/tickets/' + ticketId);
      await expect(
        ownerPage.getByRole('heading', { name: 'Audited recovery', exact: true }),
      ).toBeVisible();
      await ownerPage.getByLabel('Additional funding seconds').fill('60');
      await ownerPage.getByLabel('Extension reason', { exact: false }).fill(reviewed.reason);
      const submit = ownerPage.getByRole('button', {
        name: 'Confirm funding extension',
        exact: true,
      });
      await expect(submit).toBeDisabled();
      await ownerPage.getByRole('checkbox', { name: /I reviewed this exact challenge/ }).check();
      await submit.click();
      await expect(
        ownerPage.getByRole('button', { name: 'Retry same staff request', exact: true }),
      ).toBeVisible();
      await ownerPage.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
      await ownerPage
        .getByRole('button', { name: 'Retry same staff request', exact: true })
        .click();
      await expect(ownerPage.getByText(/The server recorded this request/)).toBeVisible();
      assert.equal(writes.length, 2);
      assert.deepEqual(writes[0], writes[1]);
      await ownerPage.unroute(adminOrigin + path + '/extensions');
      const evidence = await runtime.recoveryEvidence(challenge.challengeId);
      assert.equal(evidence.actions.length, 1);
      assert(evidence.actions[0].auditId && evidence.actions[0].outboxId);
      assert.deepEqual(evidence.challenge, initial.challenge);
      assert.deepEqual(evidence.funding, initial.funding);
      assert.equal((await current()).fundingWindow.cumulativeSeconds, 60);
    },
  );
  return { reviewed, path };
}

export async function fundAndDeclareLifecycle({
  api,
  runtime,
  creator,
  challenge,
  ticketId,
  creatorContext,
  creatorPage,
  ownerPage,
  origin,
  staffOrigin,
  browser,
  d,
  creatorRead,
  check,
}) {
  const challengePath = '/api/challenges/' + challenge.challengeId;
  await check(
    'same challenge rewards eligible funding once; verified money without timing earns no goal reward',
    async () => {
      const guestContext = await browser.newContext();
      const page = await guestContext.newPage();
      await page.goto(challenge.publicUrl);
      await page.getByLabel('Amount (EUR)', { exact: true }).fill('10.00');
      await page
        .getByRole('combobox', { name: 'Payment method', exact: true })
        .selectOption('stripe');
      await page.getByRole('checkbox', { name: /I reviewed this challenge/ }).check();
      await page.getByRole('button', { name: 'Prepare checkout', exact: true }).click();
      const heading = page.getByRole('heading', { name: 'Private contribution receipt' });
      const same = page.getByRole('button', { name: 'Continue same contribution', exact: true });
      await expect(heading.or(same)).toBeVisible();
      if (await same.isVisible()) await same.click();
      await expect(heading).toBeVisible();
      const id = new URL(page.url()).pathname.split('/').at(-1);
      const receipt = async () => {
        const r = await guestContext.request.get(api.apiOrigin + '/api/checkouts/' + id);
        assert.equal(r.status(), 200);
        return (await r.json()).data;
      };
      await api.checkoutFixture.observeStripe(id, false);
      assert.equal((await receipt()).payments.length, 1);
      assert.equal((await creatorRead(challengePath)).funding.eligibleGross, '0');
      await d.worker().tick();
      assert.equal((await creatorRead('/api/coins/account')).balance, '13');
      assert.equal((await d.inspect()).account.claims.length, 1);
      await api.checkoutFixture.observeStripe(id, true);
      await receipt();
      const funded = await creatorRead(challengePath);
      assert.equal(funded.funding.eligibleGross, '1000');
      assert.equal(funded.performance.state, 'awaiting_performance');
      await d.journal.restart();
      await d.worker().tick();
      await d.worker().tick();
      await receipt();
      await d.worker().tick();
      assert.equal((await creatorRead('/api/coins/account')).spendableBalance, '53');
      assert.equal((await d.inspect()).account.claims.length, 2);
      assert.equal(await api.checkoutFixture.declarationCount(creator.userId), 0);
      await guestContext.close();
    },
  );
  await check(
    'reviewed continuation preserves money and original terms; one creator declaration earns one journal-backed reward',
    async () => {
      const before = await runtime.recoveryEvidence(challenge.challengeId);
      const replacement = await runtime.replacement(challenge.challengeId, creator);
      await ownerPage.goto(staffOrigin + '/tickets/' + ticketId);
      await ownerPage.getByLabel('Verified replacement stream').selectOption(replacement);
      await ownerPage
        .getByLabel('Continuation reason', { exact: false })
        .fill('Reviewed same lifecycle replacement.');
      const submit = ownerPage.getByRole('button', {
        name: 'Confirm performance continuation',
        exact: true,
      });
      await expect(submit).toBeDisabled();
      await ownerPage
        .getByRole('checkbox', { name: /I reviewed this challenge, immutable original/ })
        .check();
      await submit.click();
      await expect(ownerPage.getByText(/The server recorded this request/)).toBeVisible();
      const after = await runtime.recoveryEvidence(challenge.challengeId);
      assert.deepEqual(after.challenge, before.challenge);
      assert.deepEqual(after.funding, before.funding);
      assert.equal(after.actions.length, 2);
      assert(
        after.actions.every((row) => row.ticketId === ticketId && row.auditId && row.outboxId),
      );
      assert.equal(
        after.actions.find((row) => row.kind === 'continuation')?.broadcastId,
        replacement,
      );
      await d.worker().tick();
      assert.equal((await creatorRead('/api/coins/account')).balance, '53');
      api.collectionFixture.observeReplacement(replacement);
      await creatorPage.goto(origin + '/challenges/' + challenge.challengeId);
      await creatorPage.getByRole('button', { name: 'Declare completion', exact: true }).click();
      const declaration = creatorPage.getByRole('button', {
        name: 'Confirm completion declaration',
        exact: true,
      });
      await expect(declaration).toBeDisabled();
      await creatorPage
        .getByRole('checkbox', { name: /I confirm I completed this challenge/ })
        .check();
      const recorded = creatorPage.waitForResponse(
        (response) =>
          response.url() === api.apiOrigin + challengePath + '/completion-declarations' &&
          response.request().method() === 'POST',
      );
      await declaration.click();
      const response = await recorded;
      assert.equal(
        response.status(),
        201,
        'Continued declaration response: ' + (await response.json()).error?.code,
      );
      await expect(
        creatorPage.getByText('Your completion declaration was recorded', { exact: false }),
      ).toBeVisible();
      await d.journal.restart();
      await d.worker().tick();
      await d.worker().tick();
      await creatorPage.reload();
      await creatorContext.request.get(api.apiOrigin + challengePath);
      await d.worker().tick();
      assert.equal(await api.checkoutFixture.declarationCount(creator.userId), 1);
      const account = await creatorRead('/api/coins/account');
      assert.equal(account.spendableBalance, '113');
      assert.equal((await d.inspect()).account.claims.length, 3);
      assert.deepEqual((await creatorRead(challengePath)).terms, challenge.terms);
    },
  );
}
