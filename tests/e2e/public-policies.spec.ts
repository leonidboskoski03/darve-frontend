import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';

for (const [route, title] of [
  ['/legal/terms', 'Terms of Service'],
  ['/privacy', 'Privacy Policy'],
  ['/safety', 'Community Safety Guidelines'],
] as const) {
  test(`published ${title} is readable while signed out`, async ({ page }, info) => {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toContainText('March 24, 2026');
    expect(
      await page.getByRole('article').getByRole('heading', { level: 2 }).count(),
    ).toBeGreaterThan(10);
    await expect(page.getByRole('button', { name: 'Accept and continue' })).toHaveCount(0);
    expect(await page.locator('article script').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    if (process.env.F01_CAPTURE_DIR) {
      await page.screenshot({
        path: path.join(
          process.env.F01_CAPTURE_DIR,
          route.replaceAll('/', '-') + '-' + info.project.name + '.png',
        ),
        fullPage: true,
      });
    }
  });
}

test('published FAQ uses a single-open keyboard accordion', async ({ page }, info) => {
  await page.goto('/faq');
  await expect(page.getByRole('heading', { name: 'Frequently Asked Questions' })).toBeVisible();
  const first = page.getByRole('button', { name: 'What is Darve?', exact: true });
  const second = page.getByRole('button', { name: 'Is Darve allowed by Twitch?', exact: true });
  await first.press('Enter');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await second.press('Space');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  if (process.env.F01_CAPTURE_DIR) {
    await page.screenshot({
      path: path.join(process.env.F01_CAPTURE_DIR, 'faq-' + info.project.name + '.png'),
      fullPage: true,
    });
  }
});
