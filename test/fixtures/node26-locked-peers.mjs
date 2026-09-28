// Run with exact Node 26 and the pinned pnpm CLI path. All packages and state
// are created under a fresh disposable root; no registry access is needed.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

assert.equal(process.version, 'v26.10.0');
const pnpmCli = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the pinned pnpm CLI path');
const root = await mkdtemp(join(process.env.FIXTURE_BASE ?? tmpdir(), 'node26-locked-peers-'));
const env = {
  ...process.env,
  COREPACK_HOME: join(root, 'corepack'),
  PNPM_HOME: join(root, 'pnpm-home'),
  XDG_CACHE_HOME: join(root, 'cache'),
  npm_config_cache: join(root, 'npm-cache')
};
const store = join(root, 'store');

function pnpm(args, cwd = root) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd, env, encoding: 'utf8', timeout: 120000
  });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function pack(name, version, peerRange) {
  const dir = join(root, 'packages', name);
  await mkdir(dir, {recursive: true});
  const manifest = {name, version};
  if (peerRange) manifest.peerDependencies = {'fixture-host': peerRange};
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
  requireSuccess(pnpm(['pack', '--pack-destination', root], dir), `pack ${name}`);
  return `file:${name}-${version}.tgz`;
}

try {
  await writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - '.'\nengineStrict: true\nstrictPeerDependencies: true\n");
  const version = pnpm(['--version']);
  requireSuccess(version, 'pnpm version');
  assert.equal(version.stdout.trim(), '11.18.0');
  const host = await pack('fixture-host', '1.0.0');
  const validConsumer = await pack('fixture-consumer', '1.0.0', '^1.0.0');
  const invalidConsumer = await pack('fixture-consumer', '1.0.1', '^2.0.0');
  const manifest = {
    name: 'node26-locked-peers-fixture', private: true, version: '1.0.0',
    packageManager: 'pnpm@11.18.0',
    engines: {node: '>=26.10.0 <27', pnpm: '>=11.18.0 <12'},
    dependencies: {'fixture-host': host, 'fixture-consumer': validConsumer}
  };
  const manifestPath = join(root, 'package.json');
  const lockPath = join(root, 'pnpm-lock.yaml');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const lockOnly = ['install', '--lockfile-only', '--offline', '--ignore-scripts', '--ignore-pnpmfile', '--engine-strict', '--store-dir', store];
  requireSuccess(pnpm(lockOnly), 'valid lock generation');
  requireSuccess(pnpm(['peers', 'check', '--lockfile-only']), 'valid locked peers');
  const validLockDigest = digest(await readFile(lockPath));

  manifest.dependencies['fixture-consumer'] = invalidConsumer;
  await writeFile(manifestPath, JSON.stringify(manifest));
  requireSuccess(pnpm([...lockOnly, '--no-frozen-lockfile', '--config.strict-peer-dependencies=false']), 'conflicting lock generation');
  const conflictLockDigest = digest(await readFile(lockPath));
  assert.notEqual(conflictLockDigest, validLockDigest);
  const install = pnpm([
    'install', '--frozen-lockfile', '--offline', '--ignore-scripts', '--ignore-pnpmfile',
    '--engine-strict', '--strict-peer-dependencies', '--package-import-method=copy', '--store-dir', store
  ]);
  requireSuccess(install, 'strict frozen install with locked conflict');
  assert.equal(digest(await readFile(lockPath)), conflictLockDigest, 'frozen install changed the conflict lock');
  const peers = pnpm(['peers', 'check', '--lockfile-only']);
  assert.notEqual(peers.status, 0, 'locked peer conflict was accepted');
  assert.match(`${peers.stdout}\n${peers.stderr}`, /unmet peer fixture-host[\s\S]*\^2\.0\.0/);
  assert.equal(digest(await readFile(lockPath)), conflictLockDigest, 'peer validation changed the conflict lock');
  process.stdout.write(JSON.stringify({
    node: process.version,
    pnpm: '11.18.0',
    validLockDigest,
    conflictLockDigest,
    strictFrozenInstall: 'accepted locked conflict',
    lockedPeerCheck: 'rejected unchanged conflict',
    validLockedPeerCheck: 'passed'
  }, null, 2) + '\n');
} finally {
  await rm(root, {recursive: true, force: true});
}
