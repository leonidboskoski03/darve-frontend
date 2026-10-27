import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'vendor/contracts');
const manifestPath = path.join(vendor, 'provenance.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function inspectBrowserModule(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const forbidden = new Set([
    'process',
    'Buffer',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'localStorage',
    'sessionStorage',
    'eval',
    'require',
    'Function',
  ]);
  function visit(node) {
    if (ts.isIdentifier(node) && forbidden.has(node.text))
      throw new Error(`Forbidden browser contract capability: ${file}:${node.text}`);
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const specifier = node.moduleSpecifier.text;
      if (specifier !== 'zod' && !/^\.\/[a-z0-9-]+\.js$/.test(specifier))
        throw new Error(`Unreviewed contract import: ${specifier}`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      throw new Error('Dynamic contract imports are not allowed');
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

async function pack(backend, revision) {
  if (!backend || !/^[a-f0-9]{40}$/.test(revision ?? ''))
    throw new Error('Pass backend root and a full reviewed Git revision');
  backend = path.resolve(backend);
  if (
    run(
      'git',
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        'packages/contracts',
        'tsconfig.base.json',
      ],
      backend,
    ).trim()
  )
    throw new Error('Contract inputs have uncommitted changes');
  if (run('git', ['rev-parse', revision + '^{commit}'], backend).trim() !== revision)
    throw new Error('Revision mismatch');
  if (!process.env.npm_execpath)
    throw new Error('Use npm run contracts:pack so the pinned npm CLI is available');
  const compilerRoot = path.join(backend, 'node_modules/typescript');
  const zodRoot = path.join(backend, 'node_modules/zod');
  const compiler = json(path.join(compilerRoot, 'package.json')).version;
  const zod = json(path.join(zodRoot, 'package.json')).version;
  const sourceLock = run('git', ['show', revision + ':package-lock.json'], backend);
  const locked = JSON.parse(sourceLock).packages;
  if (
    locked['node_modules/typescript']?.version !== compiler ||
    locked['node_modules/zod']?.version !== zod
  )
    throw new Error('Installed compiler/Zod differ from the reviewed backend lockfile');
  const scratchRoot = path.join(root, 'artifacts.local/f02-01');
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(path.join(scratchRoot, 'package-'));
  const archive = path.join(scratch, 'source.tar');
  run(
    'git',
    [
      'archive',
      '--format=tar',
      '--output',
      archive,
      revision,
      'packages/contracts',
      'tsconfig.base.json',
    ],
    backend,
  );
  run('tar', ['-xf', 'source.tar'], scratch);
  const pkgRoot = path.join(scratch, 'packages/contracts');
  const pkg = json(path.join(pkgRoot, 'package.json'));
  if (pkg.name !== '@darve/contracts' || pkg.dependencies.zod !== zod)
    throw new Error('Unexpected package or Zod version');
  const sourceFiles = {};
  sourceFiles['package-lock.json'] = hash(Buffer.from(sourceLock));
  for (const file of run(
    'git',
    ['ls-tree', '-r', '--name-only', revision, '--', 'packages/contracts', 'tsconfig.base.json'],
    backend,
  )
    .trim()
    .split('\n')) {
    sourceFiles[file] = hash(readFileSync(path.join(scratch, file)));
  }
  mkdirSync(path.join(pkgRoot, 'node_modules'), { recursive: true });
  cpSync(zodRoot, path.join(pkgRoot, 'node_modules/zod'), { recursive: true });
  const config = json(path.join(pkgRoot, 'tsconfig.json'));
  config.compilerOptions = {
    ...config.compilerOptions,
    composite: false,
    incremental: false,
    sourceMap: false,
    declarationMap: false,
    types: [],
    newLine: 'lf',
  };
  delete config.compilerOptions.tsBuildInfoFile;
  writeFileSync(path.join(pkgRoot, 'tsconfig.json'), JSON.stringify(config));
  run(
    process.execPath,
    [path.join(compilerRoot, 'bin/tsc'), '-p', path.join(pkgRoot, 'tsconfig.json')],
    root,
  );
  const distribution = { ...pkg, files: ['dist/*.js', 'dist/*.d.ts'], scripts: {} };
  writeFileSync(path.join(pkgRoot, 'package.json'), JSON.stringify(distribution, null, 2) + '\n');
  const packed = JSON.parse(
    run(
      process.execPath,
      [
        process.env.npm_execpath,
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        scratch,
      ],
      pkgRoot,
    ),
  )[0];
  const files = {};
  for (const entry of packed.files) {
    if (
      !['package.json', 'README.md'].includes(entry.path) &&
      !/^dist\/[a-z0-9-]+\.(js|d\.ts)$/.test(entry.path)
    )
      throw new Error(`Unexpected packed file: ${entry.path}`);
    const bytes = readFileSync(path.join(pkgRoot, entry.path));
    if (entry.path.endsWith('.js')) inspectBrowserModule(entry.path, bytes.toString());
    files[entry.path] = hash(bytes);
  }
  const exports = Object.keys(
    await import(pathToFileURL(path.join(pkgRoot, 'dist/index.js')).href),
  ).sort();
  const bytes = readFileSync(path.join(scratch, packed.filename));
  const filename = `darve-contracts-${revision}.tgz`;
  const destination = path.join(vendor, filename);
  mkdirSync(vendor, { recursive: true });
  if (existsSync(destination) && hash(readFileSync(destination)) !== hash(bytes))
    throw new Error('Existing reviewed artifact differs; never overwrite it silently');
  writeFileSync(destination, bytes);
  const manifest = {
    package: pkg.name,
    version: pkg.version,
    sourceRevision: revision,
    sourcePaths: ['packages/contracts', 'tsconfig.base.json', 'package-lock.json'],
    sourceFiles,
    build: {
      node: process.versions.node,
      npm: json(path.resolve(process.env.npm_execpath, '../../package.json')).version,
      typescript: compiler,
      zod,
      configOverrides: config.compilerOptions,
    },
    artifact: { filename, sha256: hash(bytes), integrity: packed.integrity, files },
    exports,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    JSON.stringify({
      artifact: filename,
      sha256: manifest.artifact.sha256,
      exports: exports.length,
      files: Object.keys(files).length,
      compiler,
      zod,
    }),
  );
}

async function verify() {
  const manifest = json(manifestPath);
  if (
    !/^[a-f0-9]{40}$/.test(manifest.sourceRevision) ||
    manifest.artifact.filename !== `darve-contracts-${manifest.sourceRevision}.tgz`
  )
    throw new Error('Invalid pinned artifact identity');
  const artifact = path.join(vendor, manifest.artifact.filename);
  const bytes = readFileSync(artifact);
  if (
    hash(bytes) !== manifest.artifact.sha256 ||
    'sha512-' + createHash('sha512').update(bytes).digest('base64') !== manifest.artifact.integrity
  )
    throw new Error('Artifact digest mismatch');
  // GNU tar under Git hooks treats a drive colon as a remote host separator.
  const entries = run(
    'tar',
    ['-tzf', path.relative(root, artifact).split(path.sep).join('/')],
    root,
  )
    .trim()
    .split(/\r?\n/)
    .sort();
  const expected = Object.keys(manifest.artifact.files)
    .map((f) => 'package/' + f)
    .sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected))
    throw new Error('Artifact contents mismatch');
  const pkgRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.resolve('@darve/contracts'))),
    '..',
  );
  for (const [file, digest] of Object.entries(manifest.artifact.files)) {
    if (
      !['package.json', 'README.md'].includes(file) &&
      !/^dist\/[a-z0-9-]+\.(js|d\.ts)$/.test(file)
    )
      throw new Error('Invalid installed contract path');
    const content = readFileSync(path.join(pkgRoot, file));
    if (hash(content) !== digest) throw new Error(`Installed contract differs: ${file}`);
    if (file.endsWith('.js')) inspectBrowserModule(file, content.toString());
  }
  const dependency = createRequire(path.join(pkgRoot, 'package.json')).resolve('zod/package.json');
  if (json(dependency).version !== manifest.build.zod)
    throw new Error('Contract Zod version changed');
  const exports = Object.keys(await import('@darve/contracts')).sort();
  if (JSON.stringify(exports) !== JSON.stringify(manifest.exports))
    throw new Error('Public exports changed');
  const mapPath = path.join(root, 'docs/contracts/api-map.json');
  {
    const map = json(mapPath);
    if (map.sourceRevision !== manifest.sourceRevision) throw new Error('Route map source differs');
    const ids = new Set();
    const endpoints = new Set();
    for (const route of map.operations) {
      const endpoint = `${route.origin} ${route.method} ${route.path}`;
      if (ids.has(route.id) || endpoints.has(endpoint))
        throw new Error('Duplicate mapped operation');
      ids.add(route.id);
      endpoints.add(endpoint);
      if (map.sourceFiles[route.source.file] !== route.source.sha256)
        throw new Error('Mapped source fingerprint differs');
      if (
        route.origin === 'staff-api' &&
        route.frontend !== 'excluded' &&
        (!route.path.startsWith('/admin/v1/') || route.authority !== 'staff')
      )
        throw new Error('Staff authority/origin mismatch');
      for (const name of route.publicExports)
        if (!exports.includes(name)) throw new Error(`Unknown mapped public export: ${name}`);
    }
  }
  console.log(
    `Verified exact browser contract artifact: ${Object.keys(manifest.artifact.files).length} files, ${exports.length} exports; no sibling checkout required.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'pack') await pack(process.argv[3], process.argv[4]);
  else if (process.argv[2] === 'verify') await verify();
  else throw new Error('Use pack <backend-root> <full-revision> or verify');
}
