import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectBrowserModule } from './contract-artifact.mjs';

test('accepts the public schema dependency and local ESM helpers', () => {
  assert.doesNotThrow(() =>
    inspectBrowserModule(
      'sample.js',
      "import { z } from 'zod'; export { parse } from './consumer-http.js'; export const schema = z.string();",
    ),
  );
});

for (const [label, source] of [
  ['server workspace', "import { db } from '@darve/database';"],
  ['node builtin', "import { readFile } from 'node:fs';"],
  ['relative package escape', "export { key } from '../secrets.js';"],
  ['network capability', "export const request = () => fetch('/api');"],
  ['browser storage', "export const proof = () => localStorage.getItem('proof');"],
  ['dynamic module loading', "export const load = () => import('./private.js');"],
  ['dynamic code', "export const run = new Function('return 1');"],
]) {
  test(`rejects packaged ${label}`, () => {
    assert.throws(() => inspectBrowserModule('sample.js', source));
  });
}
