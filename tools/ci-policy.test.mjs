import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, renameSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  developmentScope,
  isDocumentationOnly,
  assertReleasePolicy,
  runPolicy,
} from './ci-policy.mjs';

function removeFixture(root, parent) {
  const resolved = path.resolve(root);
  if (!resolved.startsWith(`${parent}${path.sep}ci-policy-`)) {
    throw new Error('Fixture cleanup escaped test-results.');
  }
  rmSync(resolved, { recursive: true, force: true });
}

function fixture(run) {
  const parent = path.resolve('test-results');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'ci-policy-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=.fixture-hooks', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (file, text = 'fixture\n') => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=CI Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'fixture',
    );
  };
  try {
    git('init', '-b', 'dev');
    git('config', 'core.autocrlf', 'false');
    write('README.md');
    write('src/app/main.ts', 'export const value = 1;\n');
    commit();
    run({ root, git, write, commit });
  } finally {
    removeFixture(root, parent);
  }
}

test('prose allowlist is narrow and empty diffs are not docs-only', () => {
  assert(
    isDocumentationOnly([
      'README.md',
      'docs/nested/file name.md',
      '.github/pull_request_template.md',
    ]),
  );
  for (const paths of [
    [],
    ['src/README.md'],
    ['docs/script.mjs'],
    ['.github/workflows/dev.yml'],
    ['package-lock.json'],
  ])
    assert(!isDocumentationOnly(paths));
});
test('real Git complete PR merge diff includes earlier code commits', () =>
  fixture(({ git, write, commit, root }) => {
    git('switch', '-c', 'feat/sample');
    write('src/app/main.ts', 'export const value = 2;\n');
    commit();
    write('docs/later.md');
    commit();
    git('switch', 'dev');
    git('merge', '--no-ff', '--no-commit', 'feat/sample');
    commit();
    assert.equal(developmentScope(root).docsOnly, false);
  }));
test('real Git accepts prose-only changes and deletion', () =>
  fixture(({ write, commit, root }) => {
    write('docs/file with spaces.md');
    commit();
    assert.equal(developmentScope(root).docsOnly, true);
    rmSync(path.join(root, 'docs/file with spaces.md'));
    commit();
    assert.equal(developmentScope(root).docsOnly, true);
  }));
test('renaming code to Markdown retains the removed code path', () =>
  fixture(({ root, commit }) => {
    renameSync(path.join(root, 'src/app/main.ts'), path.join(root, 'migration.md'));
    commit();
    assert.equal(developmentScope(root).docsOnly, false);
  }));
test('renaming Markdown to code selects code validation', () =>
  fixture(({ root, commit }) => {
    renameSync(path.join(root, 'README.md'), path.join(root, 'src/app/new.ts'));
    commit();
    assert.equal(developmentScope(root).docsOnly, false);
  }));
test('missing Git base fails closed', () =>
  fixture(({ root }) => {
    assert.throws(() => developmentScope(root, 'missing-ref'), /Cannot determine/);
  }));
const repository = 'owner/darve-frontend';
const pull = (source, headRepository = repository, base = 'main') => ({
  eventName: 'pull_request',
  repository,
  event: {
    pull_request: {
      head: { ref: source, repo: { full_name: headRepository } },
      base: { ref: base, repo: { full_name: repository } },
    },
  },
});
test('release PRs admit dev and hotfix but reject direct task/fork/main sources', () => {
  assert.doesNotThrow(() => assertReleasePolicy(pull('dev')));
  assert.doesNotThrow(() => assertReleasePolicy(pull('hotfix/receipt-expiry')));
  for (const input of [
    pull('feat/sample'),
    pull('main'),
    pull('hotfix/'),
    pull('dev', 'fork/darve-frontend'),
    pull('dev', repository, 'dev'),
    { eventName: 'pull_request', repository, event: {} },
  ])
    assert.throws(() => assertReleasePolicy(input));
});
test('manual full acceptance is restricted and unknown events fail', () => {
  for (const refName of ['dev', 'main', 'hotfix/sample'])
    assert.doesNotThrow(() =>
      assertReleasePolicy({ eventName: 'workflow_dispatch', repository, refName }),
    );
  for (const refName of ['feat/sample', '', undefined])
    assert.throws(() =>
      assertReleasePolicy({ eventName: 'workflow_dispatch', repository, refName }),
    );
  assert.throws(() => assertReleasePolicy({ eventName: 'push', repository, refName: 'main' }));
});
test('release CLI rejects missing or invalid event metadata', () => {
  assert.throws(() => runPolicy('release', {}), /payload/);
  assert.throws(() => runPolicy('unknown', {}), /Unknown/);
});
test('stable recording requires main push and records exact Git source', () =>
  fixture(({ root, git }) => {
    const script = path.resolve('tools/ci-policy.mjs');
    const summary = path.join(root, 'summary.txt');
    const env = {
      ...process.env,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF_NAME: 'main',
      GITHUB_STEP_SUMMARY: summary,
    };
    execFileSync(process.execPath, [script, 'record-stable'], { cwd: root, env });
    const record = readFileSync(summary, 'utf8');
    assert(record.includes(git('rev-parse', 'HEAD')));
    assert(record.includes(git('rev-parse', 'HEAD^{tree}')));
    assert(record.includes('does not deploy'));
    assert.throws(() => runPolicy('record-stable', { ...env, GITHUB_REF_NAME: 'dev' }));
  }));
