import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('foundation is honest, keyboard reachable and responsive', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The Engagement Engine');
  await expect(
    page.getByText('Streamer login, contributions and OBS integration are not connected yet.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(failures).toEqual([]);
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test('unknown deep links render a real not-found page and navigate back', async ({ page }) => {
  await page.goto('/missing-route');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Return to Darve' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The Engagement Engine');
  await expect(page.getByRole('main')).toBeFocused();
});

test('reduced motion keeps all content visible without moving the heading', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Frontend foundation', exact: true }),
  ).toBeVisible();
  await expect(heading.locator('..')).toHaveCSS('transform', 'none');
});
