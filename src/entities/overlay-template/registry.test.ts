import { expect, it } from 'vitest';
import { catalogueTemplate, resolveOverlayTemplate } from './registry';
const entry = catalogueTemplate('darve_compact', 1)!;
const value = {
  templateId: entry.id,
  assetVersion: entry.version,
  available: true,
  renderer: { key: entry.key, hash: entry.hash },
};
it('resolves only the exact approved compact descriptor and existing builtin', () => {
  expect(resolveOverlayTemplate(value)?.variant).toBe('compact');
  expect(
    resolveOverlayTemplate({
      templateId: 'standalone',
      assetVersion: 1,
      available: true,
      renderer: { key: 'standalone', hash: null },
    })?.variant,
  ).toBe('standalone');
});
it.each([
  { available: false },
  { assetVersion: 2 },
  { templateId: 'other' },
  { renderer: null },
  { renderer: { key: 'other', hash: entry.hash } },
  { renderer: { key: entry.key, hash: 'a'.repeat(64) } },
  { renderer: { key: entry.key, hash: null } },
])('hides unsupported or withdrawn metadata %j', (change) => {
  expect(resolveOverlayTemplate({ ...value, ...change })).toBeNull();
});
