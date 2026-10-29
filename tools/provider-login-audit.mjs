import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Fixed aggregate reads from this operator run only. Never selects identities, tokens or envelopes.
try {
  const runtime = JSON.parse(readFileSync('artifacts.local/f03-live/runtime.json', 'utf8'));
  const id = runtime.containers[0];
  if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9-]{36}$/.test(runtime.runId))
    throw new Error('Invalid run metadata');
  const run = (args) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const labels = run([
    'inspect',
    '--format',
    '{{index .Config.Labels "darve.frontend.task"}} {{index .Config.Labels "darve.frontend.run"}}',
    id,
  ]);
  if (labels !== `f03-live ${runtime.runId}`) throw new Error('Ownership mismatch');
  const sql = `SELECT jsonb_build_object(
    'attempts', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
      SELECT provider, intent, "authorizationPurpose" AS purpose, count(*)::int AS total,
      count(*) FILTER (WHERE "completedAt" IS NOT NULL AND "consumedAt" IS NOT NULL AND "pkceVerifierReference" IS NULL)::int AS completed
      FROM oauth_attempts GROUP BY provider, intent, "authorizationPurpose" ORDER BY provider, intent, "authorizationPurpose"
    ) x),
    'connections', (SELECT count(*)::int FROM provider_connections WHERE "unlinkedAt" IS NULL AND "revokedAt" IS NULL),
    'oneOwner', (SELECT count(DISTINCT "userId") = 1 FROM provider_connections),
    'encryptedCredentials', (SELECT count(*)::int FROM provider_credentials WHERE "accessEnvelope"->>'algorithm' = 'aes-256-gcm' AND "accessEnvelope" ? 'ciphertext'),
    'sessions', (SELECT jsonb_build_object('active', count(*) FILTER (WHERE "revokedAt" IS NULL AND "expiresAt" > clock_timestamp())::int, 'revoked', count(*) FILTER (WHERE "revokedAt" IS NOT NULL)::int) FROM darve_sessions)
  );`;
  const data = JSON.parse(
    run(['exec', id, 'psql', '-U', 'frontend', '-d', 'darve_frontend', '-At', '-c', sql]),
  );
  const record = { source: runtime.source, migrations: runtime.migrations, ...data };
  writeFileSync('artifacts.local/f03-live/audit.json', JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
} catch {
  process.stderr.write(
    "Provider-login audit unavailable. Verify this run's owned metadata and storage. No private rows are printed.\n",
  );
  process.exitCode = 1;
}
