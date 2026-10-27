import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import parser from '@typescript-eslint/parser';
import plugin from './eslint-architecture.mjs';

function inspect(code, filename = 'features/challenge/ui.tsx') {
  return new Linter().verify(
    code,
    [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { architecture: plugin },
        rules: { 'architecture/boundaries': 'error', 'architecture/infrastructure': 'error' },
      },
    ],
    { filename: `${process.cwd()}/src/${filename}` },
  );
}

const rejected = [
  ['upward alias', "import { x } from '@/app/providers';"],
  ['upward relative', "import { x } from '../../app/providers';"],
  ['sibling feature', "import { x } from '@/features/payments/index';"],
  ['deep service', "import { x } from '@/services/api/private';"],
  ['dynamic import', "const x = import('@/app/providers');"],
  ['computed import', 'const x = import(`@/${layer}/secret`);'],
  ['re-export', "export { x } from '@/app/providers';"],
  ['type import', "type X = import('@/app/providers').X;"],
  ['escape', "import { x } from '../../../darve-backend/private';"],
  ['engine bypass', "import { gsap } from 'gsap';"],
  ['require bypass', "const x = require('@/app/providers');"],
  ['network bypass', "fetch('/api/private');"],
  ['member bypass', "window.fetch('/api/private');"],
  ['computed bypass', "window['fetch']('/api/private');"],
  ['storage bypass', "localStorage.setItem('token', 'secret');"],
  ['environment bypass', 'const x = import.meta.env.VITE_KEY;'],
  ['raw HTML', 'const x = <div dangerouslySetInnerHTML={{ __html: text }} />;'],
];

for (const [name, code] of rejected) {
  test(`rejects ${name}`, () => {
    const messages = inspect(code);
    assert(
      messages.some((message) => message.ruleId?.startsWith('architecture/')),
      JSON.stringify(messages),
    );
    assert(!messages.some((message) => message.fatal), JSON.stringify(messages));
  });
}

test('accepts downward public entries and same-slice implementation', () => {
  assert.deepEqual(
    inspect(
      "import { x } from '@/services/api/index'; import { y } from './model'; import { Button } from '@/design-system/button';",
    ),
    [],
  );
});
test('accepts the route composition root', () => {
  assert.deepEqual(
    inspect("import { x } from '@/features/challenge/index';", 'routes/home.tsx'),
    [],
  );
});
test('keeps shared utilities independent', () => {
  assert(inspect("import { x } from '@/entities/challenge/index';", 'shared/date.ts').length > 0);
});
test('allows infrastructure in its owner', () => {
  assert.deepEqual(inspect("fetch('/api/status');", 'services/api/client.ts'), []);
});

test('rejects UI frameworks in pure domain models', () => {
  assert(inspect("import { useState } from 'react';", 'entities/challenge/model.ts').length > 0);
});
test('rejects routing inside business features', () => {
  assert(inspect("import { useNavigate } from 'react-router-dom';").length > 0);
});
test('rejects server state in visual primitives', () => {
  assert(
    inspect("import { useQuery } from '@tanstack/react-query';", 'design-system/button.tsx')
      .length > 0,
  );
});
test('rejects files outside the declared layers even without imports', () => {
  assert(inspect('export const value = 1;', 'misc/value.ts').length > 0);
});

test('permits only the exact public contract entry at the reviewed facade', () => {
  assert.deepEqual(
    inspect(
      "export { SessionResponseSchema } from '@darve/contracts';",
      'services/contracts/index.ts',
    ),
    [],
  );
  assert.deepEqual(
    inspect(
      "import type { SessionResponse } from '@darve/contracts';",
      'services/contracts/index.ts',
    ),
    [],
  );
});

for (const [name, source, file] of [
  ['feature direct contract import', '@darve/contracts', 'features/session/model.ts'],
  ['service facade bypass', '@darve/contracts', 'services/api/client.ts'],
  ['contract deep import', '@darve/contracts/dist/session.js', 'services/contracts/index.ts'],
  ['server domain import', '@darve/domain', 'services/contracts/index.ts'],
  ['node builtin import', 'node:crypto', 'services/contracts/index.ts'],
]) {
  test(`rejects ${name}`, () => {
    assert(
      inspect(`import { value } from '${source}';`, file).some(
        (m) => m.ruleId === 'architecture/boundaries',
      ),
    );
  });
}
