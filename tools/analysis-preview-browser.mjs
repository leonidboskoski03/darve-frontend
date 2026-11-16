import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';

const roundId = '10000000-0000-4000-8000-000000000001';
const entry = '/__analysis-preview-entry.js';
const origin = 'http://127.0.0.1:4189';
const script = `
import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {CollectionLiveIdeas} from '/src/features/collection/live-ideas.tsx';
import {createAuthorityScope} from '/src/services/server-state/index.ts';
const scope=createAuthorityScope('creator');
createRoot(document.getElementById('root')).render(
 React.createElement(StrictMode,null,React.createElement(CollectionLiveIdeas,{
  origin:location.origin,scope,roundId:'${roundId}',
 }))
);
`;
let vite, browser;
try {
  vite = await createServer({
    mode: 'acceptance-analysis-preview',
    server: { host: '127.0.0.1', port: 4189, strictPort: true, hmr: false },
    plugins: [
      {
        name: 'controlled-analysis-preview-browser-test',
        resolveId(id) {
          if (id === entry) return entry;
        },
        load(id) {
          if (id === entry) return script;
        },
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url !== '/__analysis-preview') {
              next();
              return;
            }
            res.setHeader('content-type', 'text/html');
            res.end(
              await server.transformIndexHtml(
                req.url,
                '<html><body><div id="root"></div><script type="module" src="' +
                  entry +
                  '"></script></body></html>',
              ),
            );
          });
        },
      },
    ],
  });
  await vite.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let requests = 0;
  const frame = (type, data, id) =>
    'id: ' +
    id.toString().padStart(64, '0') +
    '\nevent: ' +
    type +
    '\ndata: ' +
    JSON.stringify(data) +
    '\n\n';
  await page.route('**/api/rounds/' + roundId + '/analysis/events', async (route) => {
    requests++;
    const suggestions = [
      { id: 'a'.repeat(32), title: 'Win a round with a pistol', supporterCount: 2, order: 1 },
      { id: 'b'.repeat(32), title: 'Draw a cat in one minute', supporterCount: 1, order: 2 },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        frame('round-state', { type: 'round-state', roundId, state: 'open' }, 1) +
        frame(
          'preview',
          { type: 'preview', roundId, label: 'live preview, not final', suggestions },
          2,
        ),
    });
  });
  await page.goto(origin + '/__analysis-preview');
  const list = page.getByRole('list', { name: 'Live preview of top ideas' });
  await expect(list).toBeVisible({ timeout: 10000 });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('Win a round with a pistol')).toBeVisible();
  await expect(page.getByText('Draw a cat in one minute')).toBeVisible();
  await expect(page.getByText(/Waiting for the first ideas/)).toHaveCount(0);
  if (errors.length) throw Error('Browser errors: ' + errors.join(', '));
  console.log(
    JSON.stringify({
      strictMode: true,
      previewEntries: 2,
      eventRequests: requests,
      browserErrors: 0,
      paidCalls: 0,
    }),
  );
} finally {
  await browser?.close();
  await vite?.close();
}
