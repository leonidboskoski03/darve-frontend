import { createCoinJournal } from '@darve/integrations';
import { CoinJournalRecordPolicy } from '@darve/domain';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Bundled from the pinned backend. One bounded stdin request per disposable exec;
// no HTTP server, environment secrets, SQL credentials or arbitrary filesystem paths.
try {
  let body = '';
  for await (const chunk of process.stdin) {
    body += chunk;
    if (Buffer.byteLength(body) > 65536) throw Error('Request bound');
  }
  const input = JSON.parse(body);
  if (!['primary', 'negative'].includes(input.scope)) throw Error('Scope');
  const root = '/journal/' + input.scope;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const key = Buffer.from(input.key, 'base64');
  if (key.length !== 32) throw Error('Key');
  const journal = createCoinJournal(root, key, input.program, input.binding, 16384);
  let result;
  switch (input.command) {
    case 'ready':
      result = {
        ready: await journal.ready(),
        platform: process.platform,
        uid: process.getuid(),
        node: process.versions.node,
      };
      break;
    case 'append':
      result = await journal.append(input.record);
      break;
    case 'verify':
      result = await journal.verify(input.record);
      break;
    case 'read':
      result = await journal.read();
      break;
    case 'tamper': {
      if (input.scope !== 'negative') throw Error('Negative fixture only');
      const record = CoinJournalRecordPolicy.parse(input.record);
      const path = root + '/' + record.ownerId + '-' + record.sequence + '.json';
      const stored = JSON.parse(await readFile(path, 'utf8'));
      const bytes = Buffer.from(stored.ciphertext, 'base64');
      bytes[0] ^= 1;
      stored.ciphertext = bytes.toString('base64');
      await writeFile(path, JSON.stringify(stored));
      result = true;
      break;
    }
    default:
      throw Error('Command');
  }
  key.fill(0);
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch {
  process.stdout.write(JSON.stringify({ ok: false, code: 'JOURNAL_OPERATION_FAILED' }));
  process.exitCode = 1;
}
