import { randomBytes } from 'node:crypto';

export const providerLoginOrigins = Object.freeze({
  frontend: 'http://localhost:5174',
  api: 'http://localhost:3000',
});
export const isProviderLoginStopRequest = (request, runId) =>
  typeof runId === 'string' &&
  /^[a-f0-9-]{36}$/.test(runId) &&
  request?.action === 'stop' &&
  request.runId === runId;
const fields = [
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'KICK_CLIENT_ID',
  'KICK_CLIENT_SECRET',
];

/** Explicit operator opt-in. Never spread a backend .env into a disposable runtime. */
export function providerLoginEnvironment(input) {
  if (fields.some((field) => typeof input[field] !== 'string' || !input[field].trim()))
    throw new Error('All three provider client configurations are required. Values are private.');
  return {
    ...Object.fromEntries(fields.map((field) => [field, input[field]])),
    CREDENTIAL_ENCRYPTION_KEY_ID: 'frontend-disposable-provider-login',
    CREDENTIAL_ENCRYPTION_KEY_BASE64: randomBytes(32).toString('base64'),
    OAUTH_FRONTEND_ORIGIN: providerLoginOrigins.frontend,
    OAUTH_BACKEND_ORIGIN: providerLoginOrigins.api,
    OAUTH_RETURN_PATHS: '/,/integrations',
  };
}

export function assertProviderLoginRuntime({ task, port, origins, operatorOAuth }) {
  if (operatorOAuth !== undefined) {
    if (
      task !== 'f03-live' ||
      port !== 3000 ||
      origins.length !== 1 ||
      origins[0] !== providerLoginOrigins.frontend
    )
      throw new Error('Provider login requires its explicit isolated task and localhost ports.');
    // Re-select only approved keys; caller-supplied storage, logging and feature settings cannot leak in.
    return providerLoginEnvironment(operatorOAuth);
  }
  if (task === 'f03-live' || port === 3000)
    throw new Error('Registered callback port requires explicit provider-login configuration.');
  return {};
}
