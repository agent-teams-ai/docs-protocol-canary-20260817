import {createHash} from 'node:crypto';
import {lstat, readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';

export const runtimeModes = Object.freeze({
  production: Object.freeze({version: '24.18.0', major: 24}),
  canary: Object.freeze({version: '26.10.0', major: 26})
});

export function assertRuntimeMode(version, mode) {
  const expected = runtimeModes[mode];
  if (!expected) throw new Error(`Unsupported qualification mode: ${mode}`);
  const normalized = version.startsWith('v') ? version.slice(1) : version;
  if (normalized !== expected.version) {
    throw new Error(`${mode} qualification requires Node ${expected.version}, received ${normalized}`);
  }
  return expected;
}

async function assertAbsent(root, paths) {
  for (const path of paths) {
    try {
      await lstat(join(root, path));
      throw new Error(`${root} must not contain ${path}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export async function assertNoInstalledTree(root) {
  await assertAbsent(root, ['node_modules']);
}

export async function assertCleanSandbox(root) {
  await assertAbsent(root, ['.git', 'node_modules']);
}

// Digest the exact copied candidate before installation. Links and special files
// cannot be allowed to point reads or execution outside the copied tree.
export async function candidateTreeDigest(root) {
  const hash = createHash('sha256');
  async function visit(path, relative) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Qualification candidate contains symlink: ${relative || '.'}`);
    if (stat.isDirectory()) {
      hash.update(`D\0${relative}\0`);
      for (const entry of (await readdir(path)).sort()) {
        await visit(join(path, entry), relative ? `${relative}/${entry}` : entry);
      }
    } else if (stat.isFile()) {
      const bytes = await readFile(path);
      hash.update(`F\0${relative}\0${stat.mode & 0o111 ? 'x' : '-'}\0${bytes.length}\0`);
      hash.update(bytes);
    } else {
      throw new Error(`Qualification candidate contains unsupported file: ${relative || '.'}`);
    }
  }
  await visit(root, '');
  return `sha256:${hash.digest('hex')}`;
}

function block(text, key, indent) {
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => line === `${' '.repeat(indent)}${key}:` ? [index] : []);
  if (starts.length !== 1) throw new Error(`Lockfile must contain exactly one ${key}`);
  const start = starts[0];
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || lines[end].match(/^ */)[0].length > indent)) end++;
  return lines.slice(start + 1, end).join('\n');
}

function requireMatch(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} does not match required foundation artifact`);
}

function field(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Lockfile must contain exactly one ${label}`);
  return matches[0];
}

export function assertFoundationArtifact(contract, manifest, lockText, managed, mode = 'canary') {
  const artifact = contract.foundationArtifact;
  const publication = artifact?.required;
  if (artifact?.package !== '@agent-teams/engineering-foundation' || publication?.distribution !== 'npm' ||
      publication?.immutableVersionRequired !== true || publication?.immutableIntegrityRequired !== true) {
    throw new Error('Foundation artifact contract is incomplete');
  }
  if (mode !== 'production' && mode !== 'canary') throw new Error(`Unsupported qualification mode: ${mode}`);
  const required = mode === 'production'
    ? {...artifact.current, pnpmEngine: publication.pnpmEngine}
    : publication;
  if ((mode === 'canary' && required.status !== 'published') || !required.version || !required.integrity ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(required.integrity)) {
    throw new Error('Foundation artifact identity is pending publication');
  }
  requireMatch(manifest.devDependencies?.[artifact.package], required.version, 'Manifest foundation version');
  requireMatch(manifest.engines?.node, publication.nodeEngine, 'Manifest Node engine');
  requireMatch(manifest.engines?.pnpm, required.pnpmEngine, 'Manifest pnpm engine');
  const importer = block(block(lockText, 'importers', 0), '.', 2);
  const dependencyBlock = block(block(importer, 'devDependencies', 4), `'${artifact.package}'`, 6);
  requireMatch(field(dependencyBlock, /^\s*specifier: (.+)$/gm, 'foundation specifier')[1], required.version, 'Lockfile foundation specifier');
  requireMatch(field(dependencyBlock, /^\s*version: (.+)$/gm, 'foundation version')[1], required.version, 'Lockfile foundation version');
  const packageBlock = block(block(lockText, 'packages', 0), `'${artifact.package}@${required.version}'`, 2);
  requireMatch(field(packageBlock, /^\s*resolution: \{integrity: ([^}]+)\}$/gm, 'foundation resolution')[1], required.integrity, 'Lockfile foundation integrity');
  const engines = field(packageBlock, /^\s*engines: \{node: '([^']+)', pnpm: '([^']+)'\}$/gm, 'foundation engines');
  requireMatch(engines[1], required.nodeEngine, 'Lockfile foundation Node engine');
  requireMatch(engines[2], required.pnpmEngine, 'Lockfile foundation pnpm engine');
  const managedArtifact = managed.packages?.engineeringFoundation;
  requireMatch(managedArtifact?.version, required.version, 'Managed foundation version');
  requireMatch(managedArtifact?.integrity, required.integrity, 'Managed foundation integrity');
  requireMatch(managed.runtime?.node, required.nodeEngine, 'Managed Node engine');
  requireMatch(managed.runtime?.pnpm, required.pnpmEngine, 'Managed pnpm engine');
  return {package: artifact.package, version: required.version, integrity: required.integrity, nodeEngine: required.nodeEngine};
}
