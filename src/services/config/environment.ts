import { z } from 'zod';

const schema = z
  .object({
    VITE_APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
    VITE_PUBLIC_API_ORIGIN: z.string().optional(),
  })
  .strict();

export function parsePublicEnvironment(input: Record<string, unknown>) {
  const publicValues = Object.fromEntries(
    Object.entries(input).filter(([key]) => key.startsWith('VITE_')),
  );
  const result = schema.safeParse(publicValues);
  if (!result.success)
    throw new Error('Invalid public environment configuration. Check the documented allowlist.');
  const apiOrigin = result.data.VITE_PUBLIC_API_ORIGIN;
  if (apiOrigin !== undefined) {
    try {
      const url = new URL(apiOrigin);
      const local =
        result.data.VITE_APP_ENV === 'local' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (
        url.origin !== apiOrigin ||
        (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
        url.username ||
        url.password
      )
        throw new Error();
    } catch {
      throw new Error('Invalid public environment configuration. Check the documented allowlist.');
    }
  }
  return Object.freeze({
    appEnv: result.data.VITE_APP_ENV,
    ...(apiOrigin === undefined ? {} : { apiOrigin }),
  });
}

export const environment = parsePublicEnvironment(import.meta.env);
