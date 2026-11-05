import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { assertOwned, systemChildEnvironment } from './connected-product-config.mjs';

const postgresImage =
  'pgvector/pgvector:0.8.7-pg16@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a';
const redisImage = 'redis@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499';
export function docker(args, env) {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    }).trim();
  } catch {
    throw Error('Connected Docker operation failed. Private arguments/output are not printed.');
  }
}
export function inspect(kind, id) {
  try {
    return JSON.parse(docker(kind === 'volume' ? ['volume', 'inspect', id] : ['inspect', id]))[0];
  } catch {
    docker(['version', '--format', '{{.Server.Version}}']);
    return null;
  }
}
export async function ensureConnectedStorage({ state, save, backend }) {
  docker(['version', '--format', '{{.Server.Version}}']);
  state.resources ??= {};
  for (const [role, image, containerPort, mount] of [
    ['postgres', postgresImage, '5432', '/var/lib/postgresql/data'],
    ['redis', redisImage, '6379', '/data'],
  ]) {
    const name = 'darve-connected-' + state.profileId + '-' + role,
      volume = name + '-data';
    const labels = [
      '--label',
      'darve.frontend.task=f02-04',
      '--label',
      'darve.frontend.profile=' + state.profileId,
      '--label',
      'darve.frontend.role=' + role,
    ];
    const priorVolume = inspect('volume', volume);
    if (priorVolume) assertOwned(priorVolume, state.profileId, role);
    else if (state.resources[role] || state.schemaInitialized)
      throw Error(
        'An existing profile volume is missing. Inspect local custody before restarting.',
      );
    else docker(['volume', 'create', ...labels, volume]);
    let container = inspect('container', name);
    if (container) {
      assertOwned(container, state.profileId, role);
      if (container.Config.Image !== image)
        throw Error('Connected image differs; no automatic replacement.');
      if (
        !container.Mounts?.some(
          (entry) =>
            entry.Type === 'volume' &&
            entry.Name === volume &&
            entry.Destination === mount &&
            entry.RW,
        )
      )
        throw Error('Connected container storage does not match its owned volume.');
      if (!container.State.Running) docker(['start', container.Id]);
    } else {
      const extra =
        role === 'postgres'
          ? [
              '-e',
              'POSTGRES_USER=frontend_local',
              '-e',
              'POSTGRES_DB=darve_connected',
              '-e',
              'POSTGRES_PASSWORD',
              image,
            ]
          : [
              image,
              'redis-server',
              '--save',
              '',
              '--appendonly',
              'yes',
              '--requirepass',
              state.redisPassword,
            ];
      docker(
        [
          'run',
          '-d',
          '--name',
          name,
          ...labels,
          '-p',
          '127.0.0.1::' + containerPort,
          '-v',
          volume + ':' + mount,
          ...extra,
        ],
        role === 'postgres' ? { POSTGRES_PASSWORD: state.postgresPassword } : undefined,
      );
    }
    container = inspect('container', name);
    assertOwned(container, state.profileId, role);
    state.resources[role] = { id: container.Id, volume };
    save();
  }
  for (let i = 0; i < 40; i++) {
    try {
      docker([
        'exec',
        state.resources.postgres.id,
        'pg_isready',
        '-U',
        'frontend_local',
        '-d',
        'darve_connected',
      ]);
      break;
    } catch {
      if (i === 39) throw Error('Connected PostgreSQL readiness timed out.');
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  const ports = connectedStoragePorts(state);
  const sql = (query) =>
    docker([
      'exec',
      state.resources.postgres.id,
      'psql',
      '-X',
      '-U',
      'frontend_local',
      '-d',
      'darve_connected',
      '-At',
      '-c',
      query,
    ]);
  const root = path.join(backend, 'packages/database/prisma/migrations');
  const expected = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      name: e.name,
      checksum: createHash('sha256')
        .update(readFileSync(path.join(root, e.name, 'migration.sql')))
        .digest('hex'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sql("SELECT to_regclass('public._prisma_migrations') IS NOT NULL") === 'f') {
    if (
      state.schemaInitialized ||
      sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'") !== '0'
    )
      throw Error('Existing connected schema is incompatible. No reset/migration performed.');
    try {
      execFileSync(
        process.execPath,
        [
          path.join(backend, 'node_modules/prisma/build/index.js'),
          'migrate',
          'deploy',
          '--config',
          'packages/database/prisma.config.ts',
        ],
        {
          cwd: backend,
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...systemChildEnvironment(),
            DATABASE_URL: `postgresql://frontend_local:${state.postgresPassword}@127.0.0.1:${ports.postgres}/darve_connected`,
          },
        },
      );
    } catch {
      throw Error('Fresh owned schema initialization failed. Ordinary data is untouched.');
    }
  }
  const rows = JSON.parse(
    sql(
      `SELECT coalesce(json_agg(json_build_object('name',migration_name,'checksum',checksum) ORDER BY migration_name),'[]'::json) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    ),
  );
  if (JSON.stringify(rows) !== JSON.stringify(expected))
    throw Error(
      'Connected migration names/checksums differ from pinned source; no automatic migration performed.',
    );
  state.schemaInitialized = true;
  save();
  return { ...ports, migrations: rows.length };
}
export function connectedStoragePorts(state) {
  return Object.fromEntries(
    ['postgres', 'redis'].map((role) => {
      const resource = state.resources[role],
        c = inspect('container', resource.id);
      assertOwned(c, state.profileId, role);
      const bindings = c.NetworkSettings.Ports[(role === 'postgres' ? '5432' : '6379') + '/tcp'];
      if (
        bindings?.length !== 1 ||
        bindings[0].HostIp !== '127.0.0.1' ||
        !Number.isInteger(Number(bindings[0].HostPort))
      )
        throw Error('Connected storage must use an isolated loopback port.');
      return [role, Number(bindings[0].HostPort)];
    }),
  );
}
export function stopConnectedStorage(state) {
  for (const role of ['redis', 'postgres']) {
    const resource = state.resources?.[role];
    if (!resource) continue;
    const c = inspect('container', resource.id);
    if (!c) continue;
    assertOwned(c, state.profileId, role);
    if (c.State.Running) docker(['stop', '--time', '10', c.Id]);
  }
}
/** Acceptance operator only; never called by the normal stop/start CLI. Exact profile labels required. */
export function destroyAcceptanceStorage(state) {
  if (state.purpose !== 'acceptance')
    throw Error('Normal connected data cannot be removed by the acceptance finalizer.');
  for (const role of ['redis', 'postgres']) {
    const resource = state.resources?.[role];
    if (!resource) continue;
    const c = inspect('container', resource.id);
    if (c) {
      assertOwned(c, state.profileId, role);
      docker(['rm', '-f', c.Id]);
    }
    const v = inspect('volume', resource.volume);
    if (v) {
      assertOwned(v, state.profileId, role);
      docker(['volume', 'rm', resource.volume]);
    }
  }
}
export function inspectDevelopmentApi(id = 'darve-backend-api-1') {
  const c = inspect('container', id);
  if (
    !c ||
    c.Config.Labels?.['com.docker.compose.project'] !== 'darve-backend' ||
    c.Config.Labels?.['com.docker.compose.service'] !== 'api' ||
    !c.HostConfig.PortBindings?.['3000/tcp']?.some((p) => p.HostPort === '3000')
  )
    throw Error('Expected related development API identity/port was not found.');
  return c;
}
