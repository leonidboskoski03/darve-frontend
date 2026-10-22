import { z } from 'zod';

const schema = z
  .object({
    VITE_APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  })
  .strict();

export function parsePublicEnvironment(input: Record<string, unknown>) {
  const publicValues = Object.fromEntries(
    Object.entries(input).filter(([key]) => key.startsWith('VITE_')),
  );
  const result = schema.safeParse(publicValues);
  if (!result.success)
    throw new Error('Invalid public environment configuration. Check the documented allowlist.');
  return Object.freeze({ appEnv: result.data.VITE_APP_ENV });
}

export const environment = parsePublicEnvironment(import.meta.env);
