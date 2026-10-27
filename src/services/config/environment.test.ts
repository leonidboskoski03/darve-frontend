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
  it('accepts an explicit loopback API only for local use', () => {
    expect(parsePublicEnvironment({ VITE_PUBLIC_API_ORIGIN: 'http://127.0.0.1:3310' })).toEqual({
      appEnv: 'local',
      apiOrigin: 'http://127.0.0.1:3310',
    });
    expect(() =>
      parsePublicEnvironment({
        VITE_APP_ENV: 'staging',
        VITE_PUBLIC_API_ORIGIN: 'http://127.0.0.1:3310',
      }),
    ).toThrow();
    expect(
      parsePublicEnvironment({
        VITE_APP_ENV: 'staging',
        VITE_PUBLIC_API_ORIGIN: 'https://api.example.test',
      }).apiOrigin,
    ).toBe('https://api.example.test');
  });
  it.each([
    'https://api.example.test/path',
    'https://user:private@api.example.test',
    'http://outside.example.test',
    '//api.example.test',
    'https://api.example.test/#secret',
  ])('rejects unsafe API origin %s', (origin) => {
    expect(() => parsePublicEnvironment({ VITE_PUBLIC_API_ORIGIN: origin })).toThrow(
      'Invalid public environment configuration. Check the documented allowlist.',
    );
  });
});
