import { expect, it } from 'vitest';
import { safeCreatorReturn } from './creator-return';

it('retains a private deep link with ordinary search and fragment', () => {
  expect(safeCreatorReturn('/collection/fixture/suggestions?filter=eligible#list')).toBe(
    '/collection/fixture/suggestions?filter=eligible#list',
  );
});

it('rejects external paths, loops, guest and OBS reader routes, and omits credentials', () => {
  for (const path of [
    '//example.test/dashboard',
    'https://example.test/dashboard',
    '/authorize',
    '/contribute/fixture',
    '/overlay/fixture',
    '/%2Fdashboard',
  ])
    expect(safeCreatorReturn(path)).toBeNull();
  expect(safeCreatorReturn('/dashboard?token=one&code=two&scope=current#grant=three')).toBe(
    '/dashboard?scope=current',
  );
});
