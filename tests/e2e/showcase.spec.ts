import { expect, test, type Page } from '@playwright/test';

// Experimental immersive OBS templates (owner-requested showcase) rendered by the
// real OBS display from invented, contract-valid frames.
const origin = 'http://127.0.0.1:4175';
const immersive = [
  'minimal_glass',
  'neon_pulse',
  'classic',
  'drift',
  'contour',
  'halo',
  'ripple',
  'comet',
] as const;
const prefixes = ['glass', 'neon', 'classic', 'drift', 'contour', 'halo', 'ripple', 'comet'];
const platforms = ['twitch', 'youtube', 'kick', 'darve'];
const variants = prefixes.flatMap((prefix) => platforms.map((platform) => prefix + '_' + platform));
const colourOnly = ['standalone', 'compact'].flatMap((prefix) =>
  platforms.map((platform) => prefix + '_' + platform),
);
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

for (const template of immersive)
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

test('every colour variant renders its scene and the funding QR without errors', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const template of [...variants, ...colourOnly]) {
    const errors = await open(page, template, 'funding');
    await expect(page.locator('.obs-scene canvas')).toHaveCount(
      colourOnly.includes(template) ? 0 : 1,
    );
    await expect(page.locator('.obs-main h1')).toHaveCSS('opacity', '1');
    await expect(page.locator('.obs-qr')).toHaveCount(1);
    expect(errors, template).toEqual([]);
  }
});

test('every immersive template and variant shares the standard card layout', async ({ page }) => {
  test.setTimeout(120_000);
  const layout = async () =>
    page.evaluate(async () => {
      // Measure with the bundled font loaded, not fallback metrics.
      await document.fonts.ready;
      return [
        '.obs-card',
        '.obs-top',
        '.obs-main h1',
        '.obs-bottom',
        '.obs-progress',
        '.obs-qr',
        '.obs-qr svg',
      ].map((selector) => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return [
          selector,
          Math.round(box.x),
          Math.round(box.y),
          Math.round(box.width),
          Math.round(box.height),
        ];
      });
    });
  await open(page, 'standalone', 'funding');
  const standard = await layout();
  for (const template of [...immersive, ...variants]) {
    await open(page, template, 'funding');
    expect(await layout(), template).toEqual(standard);
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
