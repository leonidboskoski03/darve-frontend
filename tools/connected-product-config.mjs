import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

export const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
export const connectedOrigins = Object.freeze({
  frontend: 'http://localhost:5174',
  api: 'http://localhost:3000',
});
export const credentialFields = ['TWITCH', 'GOOGLE', 'KICK'].flatMap((p) =>
  ['ID', 'SECRET'].map((k) => `${p}_CLIENT_${k}`),
);
export function selectConnectedCredentials(input) {
  const selected = {};
  for (const provider of ['TWITCH', 'GOOGLE', 'KICK']) {
    const id = input[provider + '_CLIENT_ID'],
      secret = input[provider + '_CLIENT_SECRET'];
    if (
      Boolean(id) !== Boolean(secret) ||
      (id && (typeof id !== 'string' || typeof secret !== 'string'))
    )
      throw Error('Incomplete ' + provider + ' client configuration. Values are private.');
    if (id && secret) {
      selected[provider + '_CLIENT_ID'] = id;
      selected[provider + '_CLIENT_SECRET'] = secret;
    }
  }
  return selected;
}
export function readConnectedCredentials(file) {
  if (!existsSync(file)) return {};
  try {
    return selectConnectedCredentials(parseEnv(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
  } catch {
    throw Error('Private provider client configuration could not be read.');
  }
}
export function assertDataDirectory(directory) {
  const resolved = path.resolve(directory),
    allowed = path.join(frontendRoot, 'artifacts.local') + path.sep;
  if (!resolved.startsWith(allowed) || resolved === allowed.slice(0, -1))
    throw Error('Connected state must remain in the ignored frontend artifacts.local directory.');
  return resolved;
}
export function newConnectedState(source) {
  return {
    schemaVersion: 1,
    profileId: randomUUID(),
    source,
    postgresPassword: randomBytes(32).toString('hex'),
    redisPassword: randomBytes(32).toString('hex'),
    cipherKey: randomBytes(32).toString('base64'),
    overlayEpoch: randomUUID(),
  };
}
export function assertConnectedState(state, source) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  if (
    state?.schemaVersion !== 1 ||
    state.source !== source ||
    !uuid.test(state.profileId) ||
    !uuid.test(state.overlayEpoch) ||
    !/^[a-f0-9]{64}$/.test(state.postgresPassword) ||
    !/^[a-f0-9]{64}$/.test(state.redisPassword) ||
    typeof state.cipherKey !== 'string' ||
    Buffer.from(state.cipherKey, 'base64').length !== 32
  )
    throw Error(
      'Connected state/source is incompatible. Do not reset or migrate it automatically.',
    );
}
export function assertOwned(resource, profileId, role) {
  const labels = resource.Config?.Labels ?? resource.Labels;
  if (
    labels?.['darve.frontend.task'] !== 'f02-04' ||
    labels?.['darve.frontend.profile'] !== profileId ||
    labels?.['darve.frontend.role'] !== role
  )
    throw Error('Connected resource ownership differs. No operation performed.');
}
export function isPrivateProductPath(raw) {
  let value = raw;
  try {
    for (let i = 0; i < 3; i++) {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    }
  } catch {
    return true;
  }
  value = value.split('?')[0].replaceAll('\\', '/');
  return /(?:^|\/)(?:[^/]*\.local|\.env[^/]*|\.git|tests|tools|test-results|playwright-report)(?:\/|$)/i.test(
    value,
  );
}
export function checkBackendSource(backend) {
  const expected = JSON.parse(
    readFileSync(path.join(frontendRoot, 'vendor/contracts/provenance.json'), 'utf8'),
  ).sourceRevision;
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: backend,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  const inputs = [
    'apps',
    'packages',
    'infra',
    'package.json',
    'package-lock.json',
    'tsconfig*.json',
    '.npmrc',
  ];
  if (
    git('rev-parse', 'HEAD') !== expected ||
    git('diff', expected, '--', ...inputs) ||
    git('ls-files', '--others', '--exclude-standard', '--', ...inputs)
  )
    throw Error('Backend build inputs differ from the exact browser contract source.');
  return expected;
}
export function connectedServerEnvironment(backend, state, ports, credentials) {
  return {
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '3000',
    LOG_LEVEL: 'silent',
    DATABASE_URL: `postgresql://frontend_local:${state.postgresPassword}@127.0.0.1:${ports.postgres}/darve_connected`,
    REDIS_URL: `redis://:${state.redisPassword}@127.0.0.1:${ports.redis}`,
    CORS_ORIGINS: connectedOrigins.frontend,
    OAUTH_FRONTEND_ORIGIN: connectedOrigins.frontend,
    OAUTH_BACKEND_ORIGIN: connectedOrigins.api,
    OAUTH_RETURN_PATHS: '/,/integrations',
    CREDENTIAL_ENCRYPTION_KEY_ID: 'frontend-connected-local',
    CREDENTIAL_ENCRYPTION_KEY_BASE64: state.cipherKey,
    TERMS_POLICY_FILE: path.join(backend, 'infra/policies/development-terms-v1.json'),
    PUBLIC_CHALLENGE_BASE_URL: connectedOrigins.frontend + '/contribute/',
    OVERLAY_PRESENTATION_BASE_URL: connectedOrigins.frontend + '/overlay/',
    OVERLAY_GRANT_EPOCH: state.overlayEpoch,
    ...selectConnectedCredentials(credentials),
  };
}
export function systemChildEnvironment() {
  return Object.fromEntries(
    [
      'PATH',
      'Path',
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'LOCALAPPDATA',
      'APPDATA',
    ]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
}
