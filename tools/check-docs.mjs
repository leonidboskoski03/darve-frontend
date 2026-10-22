import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const files = ['README.md', 'AGENTS.md'];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (file.endsWith('.md')) files.push(file);
  }
}
await walk('docs');
let links = 0;
const failures = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [filePart] = target.split('#');
    const resolved = path.resolve(
      path.dirname(path.join(root, file)),
      decodeURIComponent(filePart),
    );
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      failures.push(`${file}: link escapes the frontend repository`);
      continue;
    }
    try {
      await access(resolved);
      links++;
    } catch {
      failures.push(`${file}: missing ${target}`);
    }
  }
}
if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else process.stdout.write(`Validated ${links} local links in ${files.length} documents.\n`);
