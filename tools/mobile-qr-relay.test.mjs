import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { createMobileQrRelay, mobileQrOrigin } from './mobile-qr-relay.mjs';
const publicId = '00112233-1234-4234-8234-112233445566',
  origin = 'https://synthetic-qr-test.trycloudflare.com';
async function fixture(work) {
  const directory = mkdtempSync(join(tmpdir(), 'darve-mobile-qr-'));
  const target = resolve(directory),
    root = resolve(tmpdir());
  if (!target.startsWith(root + sep + 'darve-mobile-qr-'))
    throw new Error('Unexpected temporary fixture path.');
  mkdirSync(join(directory, 'assets'));
  mkdirSync(join(directory, 'fonts'));
  writeFileSync(join(directory, 'index.html'), '<h1>Synthetic public contribution fixture</h1>');
  writeFileSync(join(directory, 'assets', 'public.js'), 'public fixture');
  writeFileSync(join(directory, 'fonts', 'public.woff2'), 'synthetic font');
  writeFileSync(join(directory, 'assets', 'hidden.map'), 'excluded source map');
  let clock = 1000;
  const upstream = [];
  const relay = createMobileQrRelay({
    directory,
    now: () => clock,
    fetcher: async (...args) => {
      upstream.push(args);
      return Response.json({ invalid: 'not a public contract' });
    },
  });
  relay.server.listen(0, '127.0.0.1');
  await once(relay.server, 'listening');
  const get = (path, { method = 'GET', headers = {} } = {}) =>
    new Promise((done, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: relay.server.address().port,
          path,
          method,
          headers: { Host: new URL(origin).host, ...headers },
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (body += chunk));
          response.on('end', () =>
            done({ status: response.statusCode, headers: response.headers, body }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  const bind = () =>
    relay.bind({ origin, publicId, apiOrigin: 'http://127.0.0.1:3310', deadline: clock + 10000 });
  try {
    await work({ relay, get, bind, upstream, expire: () => (clock += 10001) });
  } finally {
    relay.server.closeAllConnections();
    await new Promise((done) => relay.server.close(done));
    if (target.startsWith(root + sep + 'darve-mobile-qr-')) rmSync(target, { recursive: true });
  }
}
test('mobile origin accepts only a plain temporary HTTPS hostname', () => {
  assert.equal(mobileQrOrigin(origin), true);
  for (const value of [
    'http://127.0.0.1:4175',
    'http://test.trycloudflare.com',
    'https://trycloudflare.com.evil.test',
    'https://user@synthetic.trycloudflare.com',
    'https://synthetic.trycloudflare.com/',
    'https://synthetic.trycloudflare.com?token=x',
  ])
    assert.equal(mobileQrOrigin(value), false);
});
test('mobile relay serves only the bound public page and built static assets', () =>
  fixture(async ({ get, bind }) => {
    assert.equal((await get('/contribute/' + publicId)).status, 503);
    bind();
    assert.equal((await get('/contribute/' + publicId)).status, 200);
    assert.equal((await get('/assets/public.js')).status, 200);
    assert.equal((await get('/fonts/public.woff2')).status, 200);
    const page = await get('/contribute/' + publicId);
    assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
    assert.equal(page.headers['cache-control'], 'no-store');
  }));
test('private authorities, aliases, source maps and every mutation stay unavailable', () =>
  fixture(async ({ get, bind, upstream }) => {
    bind();
    for (const path of [
      '/',
      '/obs',
      '/__f07_observation',
      '/overlay/' + publicId,
      '/api/session',
      '/api/overlay-grants',
      '/api/checkouts/' + publicId,
      '/admin/v1/session',
      '/api/public/challenges/other',
      '/assets/hidden.map',
      '/assets/%2e%2e/index.html',
      '/contribute/' + publicId + '?token=x',
    ])
      assert.equal((await get(path)).status, 404, path);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
      assert.equal(
        (await get('/api/public/challenges/' + publicId, { method })).status,
        405,
        method,
      );
    assert.equal(
      (await get('/contribute/' + publicId, { headers: { Host: 'evil.example.test' } })).status,
      404,
    );
    assert.equal(upstream.length, 0);
  }));
test('public API requests cannot forward browser authority and invalid bodies fail closed', () =>
  fixture(async ({ get, bind, upstream }) => {
    bind();
    assert.equal(
      (
        await get('/api/public/challenges/' + publicId, {
          headers: {
            Cookie: 'darve_session=synthetic-proof',
            Authorization: 'Bearer synthetic-proof',
            'X-CSRF-Token': 'synthetic-proof',
            Origin: 'https://untrusted.example.test',
          },
        })
      ).status,
      503,
    );
    assert.equal(upstream.length, 1);
    const headers = new Headers(upstream[0][1].headers);
    assert.deepEqual([...headers.keys()], ['accept']);
    assert.equal(upstream[0][1].redirect, 'error');
    assert.equal(new URL(upstream[0][0]).origin, 'http://127.0.0.1:3310');
  }));
test('expired or rebound public surfaces cannot retain access', () =>
  fixture(async ({ relay, get, bind, expire }) => {
    bind();
    assert.throws(bind, /Invalid bounded/);
    expire();
    assert.equal((await get('/contribute/' + publicId)).status, 410);
    assert.equal((await get('/api/public/challenges/' + publicId)).status, 410);
    assert.equal(relay.audit().publicReads, 0);
  }));
