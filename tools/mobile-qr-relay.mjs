import { createServer } from 'node:http';
import { readFileSync, readdirSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { PublicChallengeResponseSchema } from '@darve/contracts';

export const mobileQrOrigin = (value) =>
  typeof value === 'string' &&
  /^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(value);
const id = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const mime = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/** Public synthetic GET-only surface, never a general reverse proxy or development server. */
export function createMobileQrRelay({ directory, fetcher = fetch, now = Date.now }) {
  let binding = null,
    assets = new Map(),
    reads = 0,
    denied = 0;
  const server = createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
    const fail = (status) => {
      denied++;
      if (!response.headersSent) response.writeHead(status, headers);
      response.end();
    };
    if (!binding) return fail(503);
    if (now() >= binding.deadline) return fail(410);
    if (request.method !== 'GET') return fail(405);
    if (request.headers.host !== new URL(binding.origin).host) return fail(404);
    const target = request.url;
    if (target === `/api/public/challenges/${binding.publicId}`) {
      try {
        // Deliberately construct fresh headers. Never forward cookies, bearer/CSRF, Origin or request bodies.
        const upstream = await fetcher(`${binding.apiOrigin}${target}`, {
          headers: { Accept: 'application/json' },
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (upstream.status !== 200) return fail(503);
        const text = await upstream.text();
        if (text.length > 2000000) return fail(503);
        const parsed = PublicChallengeResponseSchema.safeParse(JSON.parse(text));
        if (
          !parsed.success ||
          parsed.data.data.publicId !== binding.publicId ||
          parsed.data.data.contributionUrl !== binding.origin + '/contribute/' + binding.publicId ||
          parsed.data.data.checkoutAvailability.available ||
          parsed.data.data.availablePaymentProviders.some(
            (provider) => provider.availability.available,
          )
        )
          return fail(503);
        reads++;
        response.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(parsed.data));
        return;
      } catch {
        return fail(503);
      }
    }
    const file =
      target === `/contribute/${binding.publicId}`
        ? { path: binding.index, type: 'text/html; charset=utf-8' }
        : assets.get(target);
    if (!file) return fail(404);
    try {
      const data = readFileSync(file.path);
      response.writeHead(200, {
        ...headers,
        'Content-Type': file.type,
        'Content-Length': data.length,
      });
      response.end(data);
    } catch {
      return fail(503);
    }
  });
  return {
    server,
    bind(value) {
      if (
        binding ||
        !mobileQrOrigin(value.origin) ||
        !id(value.publicId) ||
        value.apiOrigin !== 'http://127.0.0.1:3310' ||
        !Number.isFinite(value.deadline) ||
        value.deadline <= now() ||
        value.deadline > now() + 1800000
      )
        throw new Error('Invalid bounded mobile QR binding.');
      const root = realpathSync(directory);
      if (!existsSync(join(root, 'index.html')))
        throw new Error('Reviewed public build is missing.');
      const collect = (folder, prefix) => {
        if (!existsSync(folder)) return;
        for (const name of readdirSync(folder)) {
          const path = join(folder, name);
          const extension = Object.keys(mime).find((suffix) => name.endsWith(suffix));
          if (!extension) continue;
          const real = realpathSync(path);
          if (!real.startsWith(root + sep)) throw new Error('Public asset escapes reviewed build.');
          assets.set(prefix + name, { path: real, type: mime[extension] });
        }
      };
      const index = realpathSync(join(root, 'index.html'));
      if (!index.startsWith(root + sep)) throw new Error('Public document escapes reviewed build.');
      collect(join(root, 'assets'), '/assets/');
      collect(join(root, 'fonts'), '/fonts/');
      binding = { ...value, index };
    },
    audit: () => ({
      publicReads: reads,
      rejectedRequests: denied,
      credentialForwarding: false,
      mutationForwarding: false,
    }),
  };
}

/** Reuses the existing reviewed executable; no account, config, named tunnel or provider secret. */
export async function openMobileQrTunnel(relay, { sourceRoot = '../darve-backend' } = {}) {
  const { cloudflaredTool, verifyTool } = await import(
    pathToFileURL(resolve(sourceRoot, 'infra/tunnel/tool.mjs')).href
  );
  const tool = cloudflaredTool();
  verifyTool(tool.path, tool.asset);
  for (const name of ['config.yml', 'config.yaml'])
    if (existsSync(join(homedir(), '.cloudflared', name)))
      throw new Error('Existing Cloudflare configuration needs separate review.');
  const env = Object.fromEntries(
    ['SystemRoot', 'WINDIR', 'PATH', 'USERPROFILE', 'TEMP', 'TMP', 'SSL_CERT_FILE', 'SSL_CERT_DIR']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  const version = spawnSync(tool.path, ['--version'], { windowsHide: true, env, encoding: 'utf8' });
  if (version.status !== 0 || !version.stdout.includes(`version ${tool.version}`))
    throw new Error('Reviewed tunnel version could not be verified.');
  relay.server.listen(4176, '127.0.0.1');
  await once(relay.server, 'listening');
  const connector = spawn(
    tool.path,
    [
      'tunnel',
      '--no-autoupdate',
      '--protocol',
      'auto',
      '--metrics',
      '127.0.0.1:0',
      '--url',
      'http://127.0.0.1:4176',
    ],
    { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(lifetime);
    connector.kill();
    relay.server.closeAllConnections();
    await new Promise((done) => relay.server.close(done));
  };
  const lifetime = setTimeout(() => void close(), 2100000);
  try {
    const origin = await new Promise((done, reject) => {
      let buffer = '',
        origin = null,
        connected = false;
      const timeout = setTimeout(() => {
        clear();
        const error = new Error('Temporary HTTPS connector was not ready.');
        error.mobileQrDiagnostic = {
          originDiscovered: !!origin,
          edgeConnected: connected,
          errors: buffer
            .split(/\r?\n/)
            .filter((line) => /\b(?:ERR|WRN)\b/.test(line))
            .slice(-4)
            .map((line) =>
              line
                .replace(/https?:\/\/\S+/g, '<url>')
                .replace(/\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/gi, '<id>')
                .slice(0, 600),
            ),
        };
        reject(error);
      }, 60000);
      const clear = () => {
        clearTimeout(timeout);
        connector.stdout.off('data', receive);
        connector.stderr.off('data', receive);
      };
      const receive = (chunk) => {
        buffer = (buffer + chunk.toString()).slice(-24000);
        const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match && mobileQrOrigin(match[0])) origin = match[0];
        if (buffer.includes('Registered tunnel connection')) connected = true;
        if (origin && connected) {
          clear();
          done(origin);
        }
      };
      connector.stdout.on('data', receive);
      connector.stderr.on('data', receive);
      connector.once('error', () => {
        clear();
        const error = new Error('Temporary HTTPS connector failed.');
        error.mobileQrDiagnostic = { spawnFailed: true };
        reject(error);
      });
      connector.once('exit', () => {
        clear();
        const error = new Error('Temporary HTTPS connector stopped.');
        error.mobileQrDiagnostic = { originDiscovered: !!origin, edgeConnected: connected };
        reject(error);
      });
    });
    connector.once('exit', () => void close());
    connector.stdout.resume();
    connector.stderr.resume();
    return { origin, close, toolVersion: tool.version, checksumVerified: true };
  } catch (error) {
    await close();
    throw error;
  }
}
