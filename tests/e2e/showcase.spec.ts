import { expect, test, type Page } from '@playwright/test';

// Experimental immersive OBS templates (owner-requested showcase) rendered by the
// real OBS display from invented, contract-valid frames.
const origin = 'http://127.0.0.1:4175';
const templates = [
  'minimal_glass',
  'neon_pulse',
  'classic',
  'glass_twitch',
  'glass_youtube',
  'glass_kick',
  'glass_darve',
  'drift',
  'contour',
  'halo',
  'ripple',
  'drift_twitch',
  'drift_youtube',
  'drift_kick',
  'drift_darve',
] as const;
const scenes = ['collecting', 'funding', 'funded', 'complete'] as const;

async function open(page: Page, template: string, scene: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(
    `${origin}/tests/fixtures/showcase.html?template=${template}&scene=${scene}&controls=0`,
  );
  await expect(page.locator('.obs-card')).toBeVisible();
  return errors;
}

for (const template of templates)
  test(`${template} renders every scene over a WebGL backdrop with readable, safe text`, async ({
    page,
  }) => {
    for (const scene of scenes) {
      const errors = await open(page, template, scene);
      await expect(page.locator('.obs-scene canvas')).toHaveCount(1);
      const heading = page.locator('.obs-main h1');
      await expect(heading).toHaveCSS('opacity', '1');
      if (scene === 'collecting') await expect(heading).toHaveText('What should we do next?');
      else
        await expect(heading).toHaveText(
          'Win the next round using only the pistol while chat picks the map',
        );
      // The contribution QR only appears while funding is still open.
      await expect(page.locator('.obs-qr')).toHaveCount(scene === 'funding' ? 1 : 0);
      if (scene === 'complete')
        await expect(page.locator('.obs-status')).toHaveText('Streamer declared complete');
      expect(errors).toEqual([]);
    }
  });

test('OBS mode keeps a transparent page and reduced motion stops the render loop', async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await open(page, 'ripple', 'funding');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.addStyleTag({ content: '.obs-main, .obs-qr { visibility: hidden !important; }' });
  const canvas = page.locator('.obs-scene canvas');
  const first = await canvas.screenshot();
  await page.waitForTimeout(800);
  expect((await canvas.screenshot()).equals(first)).toBe(true);
  await context.close();
});

test('funding bar glides to a new total instead of jumping', async ({ page }) => {
  await open(page, 'darve_compact', 'funding');
  const bar = page.locator('.obs-progress > span');
  const widths: number[] = [];
  for (let i = 0; i < 32; i++) {
    widths.push(Math.round((await bar.boundingBox())!.width));
    await page.waitForTimeout(120);
  }
  const steps = widths
    .slice(1)
    .map((value, i) => value - widths[i])
    .filter((step) => step > 0);
  // At least one donation step lands and is spread over several frames.
  expect(steps.length).toBeGreaterThanOrEqual(3);
});
