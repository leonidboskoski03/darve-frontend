import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isDocumentationOnly(paths) {
  return (
    paths.length > 0 &&
    paths.every(
      (file) =>
        /^[^/]+\.md$/.test(file) ||
        /^docs\/.*\.md$/.test(file) ||
        file === '.github/pull_request_template.md',
    )
  );
}

export function developmentScope(cwd = process.cwd(), base = 'HEAD^', head = 'HEAD') {
  // The checked-out PR merge commit's first parent is the target branch.
  // --no-renames includes both sides so code renamed to Markdown cannot skip code checks.
  let output;
  try {
    output = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head, '--'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(
      'Cannot determine the complete PR diff; refusing a light documentation shortcut.',
    );
  }
  return { docsOnly: isDocumentationOnly(output.split('\0').filter(Boolean)) };
}

export function assertReleasePolicy({ eventName, event, repository, refName }) {
  if (typeof repository !== 'string' || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error('A concrete repository identity is required.');
  }
  if (eventName === 'pull_request') {
    const pr = event?.pull_request;
    if (
      pr?.base?.ref !== 'main' ||
      pr?.head?.repo?.full_name !== repository ||
      pr?.base?.repo?.full_name !== repository
    ) {
      throw new Error('Release PRs must target this repository main from this repository.');
    }
    if (
      pr.head.ref !== 'dev' &&
      !(typeof pr.head.ref === 'string' && /^hotfix\/.+/.test(pr.head.ref))
    ) {
      throw new Error(
        'Release PRs must come from dev or hotfix/*; task branches cannot release directly.',
      );
    }
    return;
  }
  if (
    eventName === 'workflow_dispatch' &&
    (refName === 'dev' ||
      refName === 'main' ||
      (typeof refName === 'string' && /^hotfix\/.+/.test(refName)))
  )
    return;
  throw new Error(
    'Manual release acceptance requires dev, main or hotfix/*; unsupported events are rejected.',
  );
}

export function runPolicy(command, env = process.env) {
  if (command === 'development') {
    const { docsOnly } = developmentScope();
    if (!env.GITHUB_OUTPUT) throw new Error('Missing job output destination.');
    appendFileSync(env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        docsOnly
          ? 'Docs-only dev PR: formatting and links; application checks are not executed.\n'
          : 'Dev PR: formatting, lint/import architecture, types/build and links. No unit/browser suites, audit or deployment.\n',
      );
    return;
  }
  if (command === 'release') {
    if (!env.GITHUB_EVENT_PATH) throw new Error('Missing release event payload.');
    assertReleasePolicy({
      eventName: env.GITHUB_EVENT_NAME,
      event: JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')),
      repository: env.GITHUB_REPOSITORY,
      refName: env.GITHUB_REF_NAME,
    });
    return;
  }
  if (command === 'record-stable') {
    if (
      env.GITHUB_EVENT_NAME !== 'push' ||
      env.GITHUB_REF_NAME !== 'main' ||
      !env.GITHUB_STEP_SUMMARY
    )
      throw new Error('Stable source recording requires a main push.');
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `Stable frontend source\nCommit: ${revision}\nGit tree: ${tree}\nFull acceptance belongs to the release PR. This records source only; it does not deploy, tag or promote an artifact.\n`,
    );
    return;
  }
  throw new Error('Unknown CI policy command.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runPolicy(process.argv[2]);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'CI policy validation failed.'}\n`,
    );
    process.exitCode = 1;
  }
}
