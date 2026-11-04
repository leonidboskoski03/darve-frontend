import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const image = 'node:24.16.0-bookworm-slim'; // Same explicit Node baseline as the backend Dockerfile.
export function journalResourceNames(runId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId))
    throw Error('Invalid journal run identity');
  return { container: 'darve-f09-journal-' + runId, volume: 'darve-f09-journal-' + runId };
}
export function assertJournalOwnership(resource, runId, task = 'f09-g01') {
  if (!['f09-g01', 'f09-03', 'f09-04', 'f09-05'].includes(task))
    throw Error('Invalid journal task');
  const labels = resource.Config?.Labels ?? resource.Labels;
  if (labels?.['darve.frontend.task'] !== task || labels?.['darve.frontend.run'] !== runId)
    throw Error('Linux journal resource ownership differs');
}
const docker = (args, input) => {
  try {
    return execFileSync('docker', args, {
      input,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      maxBuffer: 2_000_000,
    }).trim();
  } catch (cause) {
    throw new Error('Linux journal Docker operation failed', { cause });
  }
};

export async function createLinuxCoinJournal({
  backend,
  program,
  binding,
  runId,
  task = 'f09-g01',
}) {
  if (!['f09-g01', 'f09-03', 'f09-04', 'f09-05'].includes(task))
    throw Error('Invalid journal task');
  const names = journalResourceNames(runId);
  const key = randomBytes(32);
  const scratch = resolve('artifacts.local', task, runId);
  mkdirSync(scratch, { recursive: true });
  const requireBackend = createRequire(join(backend, 'package.json'));
  const { build } = await import(pathToFileURL(requireBackend.resolve('esbuild')).href);
  const built = await build({
    entryPoints: [resolve('tools/linux-coin-journal-entry.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    write: false,
    logLevel: 'silent',
    nodePaths: [join(backend, 'node_modules')],
    plugins: [
      {
        name: 'pinned-journal',
        setup(build) {
          build.onResolve({ filter: /^@darve\/integrations$/ }, () => ({
            path: join(backend, 'packages/integrations/dist/security/coin-journal.js'),
          }));
          build.onResolve({ filter: /^@darve\/domain$/ }, () => ({
            path: join(backend, 'packages/domain/dist/index.js'),
          }));
        },
      },
    ],
  });
  const bundle = built.outputFiles[0].contents;
  writeFileSync(join(scratch, 'journal.mjs'), bundle);
  // Resolve the selected local image to an immutable content ID before creating resources.
  const base = JSON.parse(docker(['image', 'inspect', image]))[0];
  assert.equal(base.Os, 'linux');
  const labels = [
    '--label',
    'darve.frontend.task=' + task,
    '--label',
    'darve.frontend.run=' + runId,
  ];
  let container,
    volumeCreated = false,
    closed = false;
  const close = async () => {
    if (closed) return;
    if (container) {
      assertJournalOwnership(JSON.parse(docker(['inspect', container]))[0], runId, task);
      docker(['rm', '-f', container]);
      container = undefined;
    }
    if (volumeCreated) {
      assertJournalOwnership(
        JSON.parse(docker(['volume', 'inspect', names.volume]))[0],
        runId,
        task,
      );
      docker(['volume', 'rm', names.volume]);
      volumeCreated = false;
    }
    key.fill(0);
    closed = true;
  };
  const invoke = (command, record, overrides = {}) => {
    if (closed || !container) throw Error('Linux journal closed');
    const raw = docker(
      ['exec', '-i', container, 'node', '/harness/journal.mjs'],
      JSON.stringify({
        command,
        record,
        key: key.toString('base64'),
        program,
        binding,
        scope: 'primary',
        ...overrides,
      }),
    );
    const result = JSON.parse(raw);
    if (result.ok !== true) throw Error('Linux journal did not verify operation');
    return result.result;
  };
  try {
    docker(['volume', 'create', ...labels, names.volume]);
    volumeCreated = true;
    const mount = 'type=volume,source=' + names.volume + ',target=/journal';
    // Fresh owned volume only. No host path or existing volume is modified.
    docker([
      'run',
      '--rm',
      ...labels,
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--cap-add',
      'CHOWN',
      '--security-opt',
      'no-new-privileges',
      '--mount',
      mount,
      base.Id,
      'node',
      '-e',
      "require('node:fs').chownSync('/journal',1000,1000)",
    ]);
    container = docker([
      'run',
      '-d',
      '--name',
      names.container,
      ...labels,
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '1000:1000',
      '--pids-limit',
      '64',
      '--memory',
      '256m',
      '--cpus',
      '1',
      '--mount',
      mount,
      '--mount',
      'type=bind,source=' + scratch + ',target=/harness,readonly',
      base.Id,
      'node',
      '-e',
      'setInterval(()=>{},2147483647)',
    ]);
    const inspected = JSON.parse(docker(['inspect', container]))[0];
    assertJournalOwnership(inspected, runId, task);
    const metadata = invoke('ready');
    assert.deepEqual(metadata, { ready: true, platform: 'linux', uid: 1000, node: '24.16.0' });
    return {
      ready: async () => invoke('ready').ready,
      append: async (record) => invoke('append', record),
      verify: async (record) => invoke('verify', record),
      read: async () => invoke('read'),
      verifyWrongKey: async (record) =>
        invoke('verify', record, { key: randomBytes(32).toString('base64') }),
      readWrongBinding: async (wrong) => invoke('read', undefined, { binding: wrong }),
      async tamperProbe(record) {
        invoke('append', record, { scope: 'negative' });
        invoke('tamper', record, { scope: 'negative' });
        return invoke('verify', record, { scope: 'negative' });
      },
      async restart() {
        docker(['restart', container]);
        assert.equal(invoke('ready').ready, true);
      },
      async stop() {
        docker(['stop', '--time', '1', container]);
      },
      close,
      custody: {
        imageId: base.Id,
        bundleSha256: createHash('sha256').update(bundle).digest('hex'),
        platform: metadata.platform,
        uid: metadata.uid,
        node: metadata.node,
        volume: names.volume,
        network: inspected.HostConfig.NetworkMode,
        readOnlyRoot: inspected.HostConfig.ReadonlyRootfs,
        capabilitiesDropped: inspected.HostConfig.CapDrop,
        runId,
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
