import { describe, expect, it } from 'vitest';
import { parsePublicEnvironment } from './environment';

describe('public environment boundary', () => {
  it('accepts only the declared app environment', () => {
    expect(parsePublicEnvironment({ VITE_APP_ENV: 'staging', MODE: 'test' })).toEqual({
      appEnv: 'staging',
    });
  });
  it('rejects extra browser-visible settings without echoing values', () => {
    expect(() => parsePublicEnvironment({ VITE_PROVIDER_KEY: 'private-marker' })).toThrow(
      'Invalid public environment configuration. Check the documented allowlist.',
    );
  });
  it('rejects misspelled environment names', () => {
    expect(() => parsePublicEnvironment({ VITE_APP_ENV: 'prodution' })).toThrow();
  });
});
