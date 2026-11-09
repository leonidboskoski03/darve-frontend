import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { openAcceptanceTunnel } from './mobile-qr-relay.mjs';

const webhookPath = '/webhooks/paypal';
const controlPath = '/v1/notifications/webhooks';
const apiOrigin = 'http://127.0.0.1:3310';
const providerOrigin = 'https://api-m.sandbox.paypal.com';
const captureEvent = 'PAYMENT.CAPTURE.COMPLETED';
const webhookId = (value) => typeof value === 'string' && /^[A-Z0-9]{1,32}$/.test(value);
const signatures = [
  'paypal-transmission-id',
  'paypal-transmission-time',
  'paypal-transmission-sig',
  'paypal-cert-url',
  'paypal-auth-algo',
];

async function edgeAddress(origin) {
  const hostname = new URL(origin).hostname;
  const query = new URLSearchParams({ name: hostname, type: 'A' });
  const response = await fetch('https://cloudflare-dns.com/dns-query?' + query, {
    headers: { Accept: 'application/dns-json' },
    redirect: 'error',
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return null;
  const answer = await response.json();
  if (answer.Status !== 0 || !Array.isArray(answer.Answer)) return null;
  return answer.Answer.find((record) => record.type === 1 && isIPv4(record.data))?.data ?? null;
}

function probeEdge(url, address, method = 'GET') {
  const body = method === 'POST' ? '{}' : undefined;
  return new Promise((done, reject) => {
    const request = httpsRequest(
      url,
      {
        method,
        family: 4,
        autoSelectFamily: false,
        // Use the public answer only for this ephemeral host. TLS still verifies its hostname.
        lookup: (_host, _options, callback) => callback(null, address, 4),
        ...(body ? { headers: { 'Content-Type': 'application/json', 'Content-Length': '2' } } : {}),
        signal: AbortSignal.timeout(6000),
      },
      (response) => {
        response.resume();
        done(response.statusCode);
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

export function createPayPalSandboxRelay({ fetcher = fetch } = {}) {
  let active = 0,
    accepted = 0;
  const server = createServer(
    { requestTimeout: 12_000, headersTimeout: 10_000 },
    async (req, res) => {
      const finish = (status) => {
        if (!res.destroyed && !res.writableEnded)
          res.writeHead(status, { 'Cache-Control': 'no-store' }).end();
      };
      if (req.url !== webhookPath || req.method !== 'POST') return finish(404);
      const type = req.headers['content-type'];
      if (
        typeof type !== 'string' ||
        type.split(';')[0].trim().toLowerCase() !== 'application/json' ||
        req.headers['content-encoding'] ||
        signatures.some((name) => typeof req.headers[name] !== 'string')
      )
        return finish(400);
      if (active >= 4) return finish(503);
      active++;
      try {
        let bytes = 0;
        const chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 262144) return finish(413);
          chunks.push(chunk);
        }
        if (!bytes) return finish(400);
        const upstream = await fetcher(apiOrigin + webhookPath, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(12000),
          headers: {
            'Content-Type': type,
            ...Object.fromEntries(signatures.map((name) => [name, req.headers[name]])),
          },
          body: Buffer.concat(chunks),
        });
        await upstream.body?.cancel();
        if (upstream.status === 204) accepted++;
        finish(upstream.status === 204 || upstream.status === 400 ? upstream.status : 503);
      } catch {
        finish(503);
      } finally {
        active--;
      }
    },
  );
  return { server, accepted: () => accepted };
}

export async function startPayPalSandboxWebhook({ receiving, sourceRoot, custodyFile }) {
  if (existsSync(custodyFile) && JSON.parse(readFileSync(custodyFile, 'utf8')).cleanupPending)
    throw new Error('Prior owned sandbox webhook requires cleanup.');
  const relay = createPayPalSandboxRelay();
  const tunnel = await openAcceptanceTunnel(relay, { sourceRoot });
  const destination = tunnel.origin + webhookPath;
  let token = null,
    expiresAt = 0,
    ownedId = null,
    registrationAttempted = false;
  const custody = (value) => writeFileSync(custodyFile, JSON.stringify(value, null, 2));
  const request = async (path, options) =>
    fetch(providerOrigin + path, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  const control = async (path, method = 'GET', data) => {
    if (!token || expiresAt <= Date.now()) {
      const response = await request('/v1/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(receiving.clientId + ':' + receiving.clientSecret).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const authorization = await response.json();
      if (
        !response.ok ||
        authorization.app_id !== receiving.appId ||
        !/^[A-Za-z0-9._~-]{1,8192}$/.test(authorization.access_token ?? '') ||
        !Number.isInteger(authorization.expires_in) ||
        authorization.expires_in < 60
      )
        throw new Error('Sandbox webhook authentication failed.');
      token = authorization.access_token;
      expiresAt = Date.now() + (authorization.expires_in - 30) * 1000;
    }
    const response = await request(path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok) throw new Error('Sandbox webhook control failed.');
    return response.status === 204 ? null : response.json();
  };
  const close = async () => {
    try {
      if (registrationAttempted && !ownedId) {
        const list = await control(controlPath);
        const matches = list?.webhooks?.filter((hook) => hook.url === destination);
        if (!Array.isArray(matches) || matches.length > 1)
          throw new Error('Sandbox subscription custody is ambiguous.');
        if (matches.length === 1) {
          if (!webhookId(matches[0].id)) throw new Error('Sandbox webhook identifier is invalid.');
          ownedId = matches[0].id;
        }
      }
      if (ownedId) {
        const path = controlPath + '/' + ownedId;
        const current = await control(path);
        if (current) {
          if (current.id !== ownedId || current.url !== destination)
            throw new Error('Foreign webhook cleanup refused.');
          await control(path, 'DELETE');
          if (await control(path)) throw new Error('Sandbox webhook still exists after removal.');
        }
      }
      custody({ cleanupPending: false, removed: !!ownedId, verifiedIngress: relay.accepted() });
    } finally {
      await tunnel.close();
    }
  };
  try {
    let address = null;
    const edgeDeadline = Date.now() + 65_000;
    while (!address && Date.now() < edgeDeadline) {
      try {
        const candidate = await edgeAddress(tunnel.origin);
        if (candidate && (await probeEdge(tunnel.origin + '/', candidate)) === 404)
          address = candidate;
      } catch {
        // Registration can precede DNS publication and the first reachable edge request.
      }
      if (!address) await delay(2500);
    }
    if (!address)
      throw Object.assign(new Error('Sandbox relay could not be reached.'), {
        code: 'SANDBOX_RELAY_UNREACHABLE',
      });
    for (const path of ['/api/session', webhookPath]) {
      if ((await probeEdge(tunnel.origin + path, address)) !== 404)
        throw new Error('Sandbox relay route isolation failed.');
    }
    if ((await probeEdge(destination, address, 'POST')) !== 400)
      throw new Error('Sandbox relay unsigned request was not rejected.');
    custody({ cleanupPending: true, destination });
    registrationAttempted = true;
    const subscription = await control(controlPath, 'POST', {
      url: destination,
      event_types: [{ name: captureEvent }],
    });
    if (
      !webhookId(subscription?.id) ||
      subscription.url !== destination ||
      subscription.event_types?.length !== 1 ||
      subscription.event_types[0].name !== captureEvent
    )
      throw new Error('Sandbox webhook scope differs.');
    ownedId = subscription.id;
    custody({ cleanupPending: true, destination, webhookId: ownedId });
    return { id: ownedId, close, verifiedIngress: relay.accepted };
  } catch (error) {
    await close();
    throw error;
  }
}
