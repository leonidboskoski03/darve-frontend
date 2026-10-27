import { test, expect, type Page } from '@playwright/test';

const preview = 'http://127.0.0.1:4175/tests/fixtures/primitives.html';

async function frozenPreview(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: new Date('2026-10-27T12:00:00Z') });
  await page.goto(preview);
  await page.clock.pauseAt(new Date('2026-10-27T12:01:00Z'));
}

test('presence hides exiting feedback immediately, finishes removal and survives rapid reversal', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(preview);
  const toggle = page.getByRole('button', { name: 'Toggle feedback example' });
  await toggle.dispatchEvent('click');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { name: 'Feedback example' })).toHaveCount(0);
  await expect(page.locator('[inert][aria-hidden="true"]')).toHaveCount(1);
  await toggle.dispatchEvent('click');
  await expect(page.getByRole('heading', { name: 'Feedback example' })).toHaveCount(1);
  await toggle.dispatchEvent('click');
  await expect(
    page.getByText('This local message demonstrates presence', { exact: false }),
  ).toHaveCount(0);
});

test('position changes animate and preserve stable row focus during an in-row reorder', async ({
  page,
}) => {
  await frozenPreview(page);
  const list = page.getByRole('list', { name: 'Motion sample order' });
  await page.getByRole('button', { name: 'Reverse sample order' }).dispatchEvent('click');
  await expect(list.getByRole('listitem').first()).toContainText('Beta');
  await page.clock.runFor(32);
  expect(
    await list
      .locator('li')
      .evaluateAll((nodes) =>
        nodes.some((node) => Math.abs(new DOMMatrix(getComputedStyle(node).transform).m42) > 0.5),
      ),
  ).toBe(true);
  const beta = list.getByRole('button', { name: 'Move Beta sample' });
  await beta.focus();
  await beta.dispatchEvent('click');
  await expect(beta).toBeFocused();
  await expect(list.getByRole('listitem').first()).toContainText('Alpha');
  await page.clock.runFor(32);
  expect(
    await list
      .locator('li')
      .evaluateAll((nodes) =>
        nodes.every((node) => Math.abs(new DOMMatrix(getComputedStyle(node).transform).m42) < 0.5),
      ),
  ).toBe(true);
});

test('live reduced-motion changes remove exits immediately and keep new entries and positions still', async ({
  page,
}) => {
  await frozenPreview(page);
  const reveal = page.getByRole('button', { name: 'Toggle entrance example' });
  await reveal.dispatchEvent('click');
  await reveal.dispatchEvent('click');
  await page.getByRole('button', { name: 'Reverse sample order' }).dispatchEvent('click');
  await page.clock.runFor(32);
  await expect(page.locator('.preview-sequence')).not.toHaveCSS('transform', 'none');
  const toggle = page.getByRole('button', { name: 'Toggle feedback example' });
  await toggle.dispatchEvent('click');
  await expect(page.locator('[inert][aria-hidden="true"]')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[inert][aria-hidden="true"]')).toHaveCount(0);
  await expect(page.locator('.preview-sequence')).toHaveCSS('transform', 'none');
  await toggle.dispatchEvent('click');
  await expect(page.getByRole('heading', { name: 'Feedback example' })).toBeVisible();
  await page.getByRole('button', { name: 'Reverse sample order' }).dispatchEvent('click');
  await page.clock.runFor(32);
  const list = page.getByRole('list', { name: 'Motion sample order' });
  expect(
    await list
      .locator('li')
      .evaluateAll((nodes) =>
        nodes.every((node) => Math.abs(new DOMMatrix(getComputedStyle(node).transform).m42) < 0.5),
      ),
  ).toBe(true);
  await reveal.dispatchEvent('click');
  await reveal.dispatchEvent('click');
  await expect(page.locator('.preview-sequence')).toHaveCSS('transform', 'none');
});

test('interrupted entrances and navigation leave readable content and no page errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(preview);
  const reveal = page.getByRole('button', { name: 'Toggle entrance example' });
  for (let index = 0; index < 4; index++) {
    await reveal.dispatchEvent('click');
    await reveal.dispatchEvent('click');
  }
  await expect(page.locator('.preview-sequence')).toHaveCSS('transform', 'none');
  await page.goto('/');
  await page.goto('/missing-motion-test');
  await page.getByRole('link', { name: 'Return to Darve' }).click();
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
