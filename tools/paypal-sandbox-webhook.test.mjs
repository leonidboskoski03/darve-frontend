import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createPayPalSandboxRelay } from './paypal-sandbox-webhook.mjs';

test('sandbox relay forwards only the exact capture route, signature headers and bounded raw JSON', async () => {
  const calls = [];
  const relay = createPayPalSandboxRelay({
    async fetcher(url, options) {
      calls.push({ url, ...options });
      return new Response(null, { status: 204 });
    },
  });
  relay.server.listen(0, '127.0.0.1');
  await once(relay.server, 'listening');
  const origin = 'http://127.0.0.1:' + relay.server.address().port;
  const headers = {
    'Content-Type': 'application/json',
    'PayPal-Transmission-Id': 'fixture',
    'PayPal-Transmission-Time': 'fixture',
    'PayPal-Transmission-Sig': 'fixture',
    'PayPal-Cert-Url': 'fixture',
    'PayPal-Auth-Algo': 'fixture',
    Cookie: 'foreign=ignored',
    Authorization: 'Bearer ignored',
  };
  try {
    for (const path of ['/', '/api/session', '/webhooks/paypal', '/webhooks/paypal?x=1'])
      assert.equal((await fetch(origin + path)).status, 404);
    const post = (path, body, requestHeaders = headers) =>
      fetch(origin + path, { method: 'POST', headers: requestHeaders, body });
    assert.equal((await post('/webhooks/paypal?x=1', '{}')).status, 404);
    assert.equal(
      (await post('/webhooks/paypal', '{}', { 'Content-Type': 'application/json' })).status,
      400,
    );
    assert.equal((await post('/webhooks/paypal', 'x'.repeat(262145))).status, 413);
    assert.deepEqual(calls, []);
    const raw = '{ "id" : "fixture" }\n';
    assert.equal((await post('/webhooks/paypal', raw)).status, 204);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:3310/webhooks/paypal');
    assert.equal(calls[0].body.toString(), raw);
    assert.equal(Object.keys(calls[0].headers).length, 6);
    assert.equal(calls[0].headers['paypal-transmission-sig'], 'fixture');
    assert.equal(relay.accepted(), 1);
  } finally {
    relay.server.closeAllConnections();
    await new Promise((done) => relay.server.close(done));
  }
});
