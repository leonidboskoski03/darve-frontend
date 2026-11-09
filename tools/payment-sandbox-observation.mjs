import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import jsQR from 'jsqr';

export async function observeSandboxChallenge({
  browser,
  owner,
  origin,
  get,
  challenge,
  publicId,
}) {
  const path = '/challenges/' + challenge.id;
  const apiPath = '/api/challenges/' + challenge.id;
  const publicPath = '/api/public/challenges/' + publicId;
  const detail = await get(apiPath);
  assert.equal(detail.roundId, challenge.roundId);
  assert.equal(detail.publicId, publicId);
  assert.equal(detail.funding.eligibleGross, '0');
  const creatorPage = await owner.newPage();
  await creatorPage.goto(origin + '/obs');
  await creatorPage.getByRole('checkbox', { name: /I understand this read-only link/ }).check();
  await creatorPage.getByRole('button', { name: 'Create private OBS link' }).click();
  const grant = creatorPage.getByLabel('Private browser-source URL');
  await expect(grant).toBeVisible();
  const privateLink = await grant.inputValue();
  const displayId = new URL(privateLink).pathname.split('/').at(-1);
  await creatorPage.getByRole('button', { name: 'Review for display', exact: true }).click();
  await creatorPage.getByRole('checkbox', { name: /Show this selection/ }).check();
  await creatorPage.getByRole('button', { name: 'Confirm display selection' }).click();
  await expect(
    creatorPage.getByRole('status').filter({ hasText: 'Display selection confirmed' }),
  ).toBeVisible();
  const binding = await get('/api/overlay-displays/' + displayId);
  assert.equal(binding.challengeId, challenge.id);
  assert.equal(binding.roundId, challenge.roundId);
  const reader = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const obs = await reader.newPage();
  await obs.goto(privateLink, { waitUntil: 'domcontentloaded' });
  await expect(obs.getByRole('heading', { name: detail.terms.text, exact: true })).toBeVisible();
  assert.ok(new URL(obs.url()).hash.startsWith('#grantId='));
  const bar = obs.getByRole('progressbar', { name: 'Deadline-eligible contributions' });
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  const qr = obs.getByRole('img', { name: 'Scan to view this challenge' });
  const pixels = await qr.evaluate(async (node) => {
    const image = new globalThis.Image();
    image.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(new globalThis.XMLSerializer().serializeToString(node));
    await image.decode();
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = canvas.height = 150;
    const drawing = canvas.getContext('2d');
    drawing.imageSmoothingEnabled = false;
    drawing.drawImage(image, 0, 0, 150, 150);
    return Array.from(drawing.getImageData(0, 0, 150, 150).data);
  });
  const destination = jsQR(new Uint8ClampedArray(pixels), 150, 150)?.data;
  assert.equal(destination, detail.contributionUrl);
  assert.equal(destination, origin + '/contribute/' + publicId);

  return {
    async finish() {
      const funded = await get(apiPath);
      const publicFunded = await get(publicPath);
      for (const view of [funded, publicFunded]) {
        assert.equal(view.terms.version, detail.terms.version);
        assert.equal(view.funding.confirmedGross, '1000');
        assert.equal(view.funding.eligibleGross, '1000');
        assert.equal(view.funding.state, 'funded');
        assert.equal(view.performance.state, 'awaiting_performance');
      }
      await expect(bar).toHaveAttribute('aria-valuenow', '100', { timeout: 15000 });
      await expect(obs.getByText('Goal reached', { exact: true })).toBeVisible();
      await expect(qr).toHaveCount(0);
      await creatorPage.goto(origin + path);
      await creatorPage.getByRole('button', { name: 'Declare completion', exact: true }).click();
      const confirm = creatorPage.getByRole('button', {
        name: 'Confirm completion declaration',
        exact: true,
      });
      await expect(confirm).toBeDisabled();
      await creatorPage
        .getByRole('checkbox', { name: /I confirm I completed this challenge/ })
        .check();
      await confirm.click();
      await expect(
        creatorPage.getByText('Your completion declaration was recorded', { exact: false }),
      ).toBeVisible();
      await expect(obs.getByText('Streamer declared complete', { exact: true })).toBeVisible({
        timeout: 15000,
      });
      const declared = await get(apiPath);
      const publicDeclared = await get(publicPath);
      assert.equal(declared.performance.verification, 'streamer_declaration');
      assert.equal(publicDeclared.performance.state, 'declared_complete');
      assert.deepEqual(declared.terms, detail.terms);
      const { history } = await get('/api/dashboard/summary?timeZone=UTC');
      assert.equal(history.streamerDeclaredCompletions, 1);
      assert.deepEqual(
        history.contributionsByCurrency.map((row) => [
          row.currency,
          row.grossContributions,
          row.paymentCount,
        ]),
        [[detail.terms.goal.currency, '1000', 1]],
      );
      return {
        qrMatchesChallenge: true,
        eligibleGross: '1000',
        currency: detail.terms.goal.currency,
        observedObsFundingAndDeclaration: true,
        streamerDeclarations: 1,
      };
    },
  };
}
