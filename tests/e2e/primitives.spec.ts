import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const preview = 'http://127.0.0.1:4175/tests/fixtures/primitives.html';

test('component reference wraps long content, serves local assets and passes sampled dark/light contrast', async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4175') return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(preview);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { name: 'Component reference' })).toBeVisible();
  expect(
    await page.locator('.brand-mark').evaluate((img) => (img as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.fonts.check('400 16px Inter', 'Łukasz'))).toBe(true);
  await page.getByRole('button', { name: 'Show example error' }).click();
  await expect(page.getByRole('textbox', { name: 'Example title' })).toHaveAccessibleDescription(
    'Preview text stays in this page. This example demonstrates a validation message.',
  );
  for (const mode of ['dark', 'light']) {
    if (mode === 'light') await page.getByRole('button', { name: 'Use light canvas' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('dialog keeps the background inert, supports Escape, restores focus and reopens under StrictMode', async ({
  page,
}) => {
  await page.goto(preview);
  const trigger = page.getByRole('button', { name: 'Open dialog', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Review the example' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await trigger.evaluate((node) => node.focus());
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    // Chromium may pass through browser chrome (reported as body), never background controls.
    expect(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          Boolean(document.activeElement?.closest('dialog')),
      ),
    ).toBe(true);
  }
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: 'Close example', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.evaluate((node) => (node as HTMLDialogElement).close());
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('narrow reflow and reduced motion preserve readable controls and dialog access', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(preview);
  expect(
    await page
      .getByRole('button', { name: 'Pending action' })
      .locator('.ds-spinner')
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Close example', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  // Text resize is independent of device-pixel scaling and exercises rem-based controls.
  await page.setViewportSize({ width: 640, height: 720 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close example', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('component fixture has no production route', async ({ page }) => {
  await page.goto('/tests/fixtures/primitives.html');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
