import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { startLocalApi } from './local-api.mjs';
const selectedProvider = process.argv[2],
  approval = process.argv[3];
const origin = 'http://127.0.0.1:4175';
const currency = selectedProvider === 'paypal' ? 'USD' : 'EUR';
const operatorDeadline = Date.now() + 1800000;
let api,
  vite,
  browser,
  stage = 'startup';
try {
  api = await startLocalApi({
    backend: process.argv[4] ?? '../tmp/backend-f06-checkout',
    origins: [origin],
    task: 'f06-04',
    collection: true,
    review: true,
    sandboxPayment: {
      provider: selectedProvider,
      approval,
      sourceRoot: process.argv[5] ?? '../darve-backend',
    },
    terms: true,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  vite = await createServer({
    plugins: [
      ...(api.sandboxFixture.setupPlugin ? [api.sandboxFixture.setupPlugin] : []),
      {
        name: 'sandbox-only-notice',
        transformIndexHtml: () => [
          {
            tag: 'aside',
            injectTo: 'body-prepend',
            attrs: {
              style:
                'padding:12px;background:#fff0c2;color:#171717;text-align:center;font:16px sans-serif',
            },
            children: `SANDBOX TEST ONLY · ${currency}10.00 contribution / ${currency}0.70 synthetic Darve fee · No real money, delivery or refund promise. Use test payment details only.`,
          },
        ],
      },
    ],
    mode: 'acceptance-contribution',
    envDir: false,
    clearScreen: false,
    server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
  });
  await vite.listen();
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 2100000 }),
    owner = await browser.newContext();
  await owner.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const session = await (
    await owner.request.get(api.apiOrigin + '/api/session', { headers: { Origin: origin } })
  ).json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrfToken };
  const policy = (
    await (await owner.request.get(api.apiOrigin + '/api/terms/current', { headers })).json()
  ).data;
  assert.equal(
    (
      await owner.request.post(api.apiOrigin + '/api/terms/acceptance', {
        headers,
        data: {
          documentId: policy.documentId,
          version: policy.version,
          contentHash: policy.contentHash,
          accepted: true,
        },
      })
    ).status(),
    200,
  );
  const get = async (path) => {
    const response = await owner.request.get(api.apiOrigin + path, { headers });
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  api.collectionFixture.capacity('available');
  async function accepted(seconds = 600) {
    const stream = await api.collectionFixture.seed(creator.userId);
    const start = await owner.request.post(api.apiOrigin + '/api/rounds', {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        connectionId: stream.connectionId,
        broadcastId: stream.broadcastId,
        collectionDurationSeconds: 60,
        announcementPinMode: 'off',
      },
    });
    assert.equal(start.status(), 202);
    const roundId = (await start.json()).data.id;
    await api.collectionFixture.recover();
    const active = await get('/api/rounds/' + roundId);
    await api.collectionFixture.admitIdeas(creator.userId, roundId);
    assert.equal(
      (
        await owner.request.post(`${api.apiOrigin}/api/rounds/${roundId}/collection/stop`, {
          headers,
          data: { expectedVersion: active.version },
        })
      ).status(),
      202,
    );
    await api.reviewFixture.publish(creator.userId, roundId);
    const suggestions = await get(`/api/rounds/${roundId}/suggestions`),
      item = suggestions.items[0];
    const result = await owner.request.post(
      `${api.apiOrigin}/api/rounds/${roundId}/suggestions/${item.id}/accept`,
      {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          expectedVersion: item.version,
          analysisRunId: item.analysisRunId,
          resultVersion: suggestions.resultVersion,
          snapshotVersion: item.snapshotVersion,
          goal: { amountMinor: '100000', currency },
          fundingDurationSeconds: seconds,
        },
      },
    );
    assert.equal(result.status(), 201);
    return { id: (await result.json()).data.id, roundId };
  }
  stage = 'verify original sandbox receiving binding';
  await api.sandboxFixture.configure(creator.userId, creator.secret, session.csrfToken);
  if (api.sandboxFixture.requiresSetup) {
    console.log(
      JSON.stringify({
        stage: 'awaiting_existing_seller_consent',
        url: origin + '/sandbox/setup',
        provider: selectedProvider,
        currency,
        newAccountCreation: false,
      }),
    );
    await api.sandboxFixture.waitForSetup(Math.min(600000, operatorDeadline - Date.now()));
  }
  const challenge = await accepted(1800);
  const { publicId } = await api.sandboxFixture.bindChallenge(challenge.id);
  await owner.close();
  await browser.close();
  browser = undefined;
  const directory = 'artifacts.local/f06-04-' + selectedProvider;
  mkdirSync(directory, { recursive: true });
  const statusFile = directory + '/status.json',
    controlFile = directory + '/control.json';
  const readyAt = Date.now(),
    deadline = operatorDeadline;
  const publicUrl = origin + '/contribute/' + publicId;
  const status = async (current) =>
    writeFileSync(
      statusFile,
      JSON.stringify(
        {
          task: 'F06-04',
          runId: api.runId,
          source: api.source,
          frontendSource: '59ee61f30f64ebf0781e1bf14573aebb3a226d7f plus explicit sandbox tooling',
          provider: selectedProvider,
          stage: current,
          publicUrl,
          readyAt: new Date(readyAt).toISOString(),
          expiresAt: new Date(deadline).toISOString(),
          ordinaryPaymentsEnabled: false,
          newAccountsAllowed: false,
          syntheticSourceAndAgreement: true,
          actualProviderAndReceiving: true,
          ...(await api.sandboxFixture.audit()),
        },
        null,
        2,
      ),
    );
  await status('awaiting_fresh_viewer');
  console.log(
    JSON.stringify({
      stage: 'awaiting_fresh_viewer',
      publicUrl,
      provider: selectedProvider,
      amount: '10.00 ' + currency,
      syntheticFee: '0.70 ' + currency,
      minutes: 30,
      newAccountCreation: false,
    }),
  );
  stage = 'human sandbox approval and canonical receipt';
  let finished = false;
  while (Date.now() < deadline) {
    const audit = await api.sandboxFixture.audit();
    await status(
      audit.paymentCount === 1
        ? 'payment_recorded_awaiting_receipt_checks'
        : 'awaiting_fresh_viewer',
    );
    if (existsSync(controlFile)) {
      let command;
      try {
        command = JSON.parse(readFileSync(controlFile, 'utf8'));
      } catch {
        command = null;
      }
      if (command?.runId === api.runId && command.action === 'stop') {
        await status('stopped_incomplete');
        break;
      }
      if (command?.runId === api.runId && command.action === 'finish') {
        assert.equal(audit.providerCreateCalls, 1);
        assert.equal(audit.attemptCount, 1);
        assert.equal(audit.paymentCount, 1);
        assert.equal(audit.expectedAmountAndFee, true);
        assert.equal(audit.expectedPaymentAmount, true);
        assert.equal(audit.accountCreationCalls, 0);
        if (selectedProvider === 'paypal') assert.equal(audit.captureCalls, 1);
        assert.equal(audit.guestIssues, 1);
        assert.ok(audit.resumeCalls >= 1);
        assert.ok(audit.verifiedReceiptReads >= 2);
        const result = {
          ...audit,
          runId: api.runId,
          backendSource: api.source,
          frontendSource: '59ee61f30f64ebf0781e1bf14573aebb3a226d7f plus sandbox tooling',
          migrations: api.migrations,
          freshViewerAndProviderApproval: true,
          canonicalReceiptReload: true,
          externalTestPayment: true,
          syntheticReceiving: false,
          ordinaryActivation: false,
          newAccountCreation: false,
          persistentDataChanged: false,
          tracesOrScreenshots: false,
        };
        writeFileSync(directory + '/acceptance.json', JSON.stringify(result, null, 2));
        await status('passed');
        finished = true;
        console.log(JSON.stringify({ stage: 'passed', ...result }));
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!finished) {
    await status('incomplete');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify({
      failedStage: stage,
      errorType: error?.name ?? 'Error',
      safeCode: /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'SANDBOX_UNAVAILABLE',
      sourceLine:
        (error?.stack ?? '').match(
          /(?:payment-sandbox|payment-sandbox-fixture)\.mjs:\d+:\d+/,
        )?.[0] ?? null,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite?.close();
  await api?.close();
}
