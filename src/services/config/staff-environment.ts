import { z } from 'zod';

const schema = z.strictObject({
  STAFF_PUBLIC_APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  STAFF_PUBLIC_API_ORIGIN: z.string().min(1).optional(),
  STAFF_PUBLIC_AUTHORIZATION_ENDPOINT: z.string().min(1).optional(),
});
export function parseStaffEnvironment(input: Record<string, unknown>) {
  try {
    const values = schema.parse(
      Object.fromEntries(Object.entries(input).filter(([key]) => key.startsWith('STAFF_PUBLIC_'))),
    );
    const api = values.STAFF_PUBLIC_API_ORIGIN;
    const authorization = values.STAFF_PUBLIC_AUTHORIZATION_ENDPOINT;
    if (Boolean(api) !== Boolean(authorization)) throw Error();
    for (const [value, isOrigin] of [
      [api, true],
      [authorization, false],
    ] as const) {
      if (value === undefined) continue;
      const url = new URL(value);
      const loopback =
        values.STAFF_PUBLIC_APP_ENV === 'local' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        url.username ||
        url.password ||
        url.hash ||
        url.search ||
        (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
        (isOrigin ? url.origin !== value : url.href !== value)
      )
        throw Error();
    }
    return Object.freeze({
      appEnv: values.STAFF_PUBLIC_APP_ENV,
      ...(api && authorization ? { apiOrigin: api, authorizationEndpoint: authorization } : {}),
    });
  } catch {
    throw new Error('Invalid staff public configuration. Check the documented allowlist.');
  }
}
