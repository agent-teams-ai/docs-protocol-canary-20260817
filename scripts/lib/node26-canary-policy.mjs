import {createHash} from 'node:crypto';
import {lstat, readFile, readdir, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';

export const runtimeModes = Object.freeze({
  production: Object.freeze({version: '24.18.0', major: 24}),
  canary: Object.freeze({version: '26.10.0', major: 26}),
  'package-compatibility': Object.freeze({version: '26.10.0', major: 26})
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

function requireMatch(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} does not match required foundation artifact`);
}

// The parsers are declared in the disposable publication fixture, never resolved
// through a managed package's private/transitive dependencies or source install.
export function loadPolicyTools(fixtureRoot) {
  if (!fixtureRoot) throw new Error('NODE26_POLICY_TOOLS must name an isolated installed publication fixture');
  const require = createRequire(join(fixtureRoot, 'package.json'));
  requireMatch(require('semver/package.json').version, '7.8.5', 'Policy semver version');
  requireMatch(require('yaml/package.json').version, '2.9.1', 'Policy YAML version');
  return {semver: require('semver'), parseDocument: require('yaml').parseDocument};
}

export function parseLockfile(lockText, tools) {
  const document = tools.parseDocument(lockText, {uniqueKeys: true, strict: true});
  if (document.errors.length) throw new Error(`Invalid lockfile YAML: ${document.errors[0].message}`);
  const lock = document.toJS({maxAliasCount: 0});
  if (String(lock?.lockfileVersion) !== '9.0' && String(lock?.lockfileVersion) !== '9') {
    throw new Error('Expected pnpm lockfile version 9');
  }
  if (Object.keys(lock.importers ?? {}).join() !== '.') throw new Error('Lockfile must have exactly one root importer');
  return lock;
}

export function assertRange(version, range, label, tools) {
  if (typeof range !== 'string' || !range.trim() || !tools.semver.validRange(range) ||
      !tools.semver.valid(version) || !tools.semver.satisfies(version, range)) {
    throw new Error(`${label} rejects runtime ${version}: ${range}`);
  }
}

// Only the pnpm peer-qualified suffix is admitted, with balanced, nonempty groups.
// Peers themselves remain the responsibility of the real locked peer command.
export function assertLocator(locator, version) {
  if (locator === version) return;
  if (typeof locator !== 'string' || !locator.startsWith(`${version}(`)) throw new Error('Invalid exact package locator');
  const groups = [];
  for (const character of locator.slice(version.length)) {
    if (character === '(') groups.push(false);
    else if (character === ')') {
      if (groups.pop() !== true) throw new Error('Invalid peer-qualified package locator');
      if (groups.length) groups[groups.length - 1] = true;
    } else {
      if (!groups.length || /\s/.test(character)) throw new Error('Invalid peer-qualified package locator');
      groups[groups.length - 1] = true;
    }
  }
  if (groups.length) throw new Error('Invalid peer-qualified package locator');
}

function assertCoordinate(coordinate, manifest, lock, runtime, tools) {
  if (!tools.semver.valid(coordinate.version) ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(coordinate.integrity ?? '')) {
    throw new Error('Foundation artifact identity is pending publication');
  }
  const name = coordinate.package;
  if (coordinate.direct) {
    requireMatch(manifest.devDependencies?.[name], coordinate.version, `Manifest ${name} version`);
    const root = lock.importers['.'].devDependencies?.[name];
    requireMatch(root?.specifier, coordinate.version, `Lockfile ${name} specifier`);
    assertLocator(root?.version, coordinate.version);
    if (!Object.hasOwn(lock.snapshots ?? {}, `${name}@${root.version}`)) throw new Error(`Missing ${name} root snapshot`);
  }
  const metadata = lock.packages?.[`${name}@${coordinate.version}`];
  requireMatch(metadata?.resolution?.integrity, coordinate.integrity, `Lockfile ${name} integrity`);
  if (metadata.resolution.tarball || metadata.resolution.type || metadata.resolution.directory) {
    throw new Error(`Non-registry ${name} resolution`);
  }
  assertRange(runtime.node, coordinate.nodeEngine, `Published ${name} Node engine`, tools);
  assertRange(runtime.node, metadata.engines?.node, `Lockfile ${name} Node engine`, tools);
  if (coordinate.pnpmEngine) {
    assertRange(runtime.pnpm, coordinate.pnpmEngine, `Published ${name} pnpm engine`, tools);
    assertRange(runtime.pnpm, metadata.engines?.pnpm, `Lockfile ${name} pnpm engine`, tools);
  }
}

export function assertFoundationArtifact(contract, manifest, lockText, managed, mode = 'canary', tools,
  runtime = {node: runtimeModes[mode]?.version, pnpm: '11.18.0'}) {
  const artifact = contract.foundationArtifact;
  const publication = artifact?.required;
  if (artifact?.package !== '@agent-teams/engineering-foundation' || publication?.distribution !== 'npm' ||
      publication?.immutableVersionRequired !== true || publication?.immutableIntegrityRequired !== true) {
    throw new Error('Foundation artifact contract is incomplete');
  }
  if (mode !== 'production' && mode !== 'canary') throw new Error(`Unsupported qualification mode: ${mode}`);
  assertRuntimeMode(runtime.node, mode);
  const required = mode === 'production' && managed.cohortId === artifact.current.cohortId ? artifact.current : publication;
  if ((required !== artifact.current && required.status !== 'published') || !required.version || !required.integrity ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(required.integrity)) {
    throw new Error('Foundation artifact identity is pending publication');
  }
  requireMatch(manifest.devDependencies?.[artifact.package], required.version, 'Manifest foundation version');
  const lock = parseLockfile(lockText, tools);
  assertRange(runtime.node, manifest.engines?.node, 'Consumer Node engine', tools);
  assertRange(runtime.pnpm, manifest.engines?.pnpm, 'Consumer pnpm engine', tools);
  assertCoordinate({...required, package: artifact.package, direct: true}, manifest, lock, runtime, tools);
  const managedArtifact = managed.packages?.engineeringFoundation;
  requireMatch(managedArtifact?.version, required.version, 'Managed foundation version');
  requireMatch(managedArtifact?.integrity, required.integrity, 'Managed foundation integrity');
  requireMatch(managed.cohortId, required.cohortId, 'Managed cohort');
  const dependencies = required === artifact.current ? required.publishedDependencies : artifact.publishedDependencies;
  if (dependencies?.length !== 4) throw new Error('Incomplete selected cohort identities');
  for (const coordinate of dependencies) {
    assertCoordinate(coordinate, manifest, lock, runtime, tools);
    const selected = managed.packages?.[coordinate.managedKey];
    requireMatch(selected?.version, coordinate.version, `Managed ${coordinate.package} version`);
    requireMatch(selected?.integrity, coordinate.integrity, `Managed ${coordinate.package} integrity`);
  }
  // Public dual-engine support does not authorize the selected managed runtime.
  assertRange(runtime.node, contract.managedQualification.nodeEngine, 'Released managed check Node engine', tools);
  assertRange(runtime.node, managed.runtime?.node, 'Selected managed Node engine', tools);
  assertRange(runtime.pnpm, managed.runtime?.pnpm, 'Selected managed pnpm engine', tools);
  return {package: artifact.package, version: required.version, integrity: required.integrity, nodeEngine: required.nodeEngine};
}

export function assertPublicationFixture(contract, manifest, lockText, runtime, tools) {
  const lock = parseLockfile(lockText, tools);
  const coordinates = [{...contract.foundationArtifact.required, package: contract.foundationArtifact.package, direct: true},
    ...contract.foundationArtifact.publishedDependencies];
  if (coordinates.length !== 5 || new Set(coordinates.map(c => c.package)).size !== 5 ||
      contract.foundationArtifact.required.status !== 'published') throw new Error('Incomplete published package fixture');
  assertRange(runtime.node, manifest.engines?.node, 'Fixture Node engine', tools);
  assertRange(runtime.pnpm, manifest.engines?.pnpm, 'Fixture pnpm engine', tools);
  for (const coordinate of coordinates) assertCoordinate(coordinate, manifest, lock, runtime, tools);
  for (const dependency of contract.policyTools) assertCoordinate({...dependency, direct: true}, manifest, lock, runtime, tools);
  // Retain the exact internal edges for every selected peer context.
  for (const [key, snapshot] of Object.entries(lock.snapshots ?? {})) {
    const origin = coordinates.find(c => key.startsWith(`${c.package}@`));
    if (!origin) continue;
    assertLocator(key.slice(origin.package.length + 1), origin.version);
    for (const [from, to] of contract.packageCompatibility.internalEdges) {
      if (origin.package !== from) continue;
      const target = coordinates.find(c => c.package === to);
      const locator = snapshot.dependencies?.[to];
      assertLocator(locator, target.version);
      if (!Object.hasOwn(lock.snapshots, `${to}@${locator}`)) throw new Error(`Missing ${to} edge snapshot`);
    }
  }
  return coordinates.map(({package: name, version, integrity}) => ({package: name, version, integrity}));
}

export async function acquireDirectory(path) {
  const current = await lstat(path);
  if (!current.isDirectory()) throw new Error(`Qualification directory was replaced: ${path}`);
  return {dev: current.dev, ino: current.ino};
}

export async function ownsDirectory(path, owned) {
  if (!owned) return false;
  try {
    const current = await lstat(path);
    return current.isDirectory() && current.dev === owned.dev && current.ino === owned.ino;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function ownsChild(root, ownedRoot, path, ownedChild) {
  return await ownsDirectory(root, ownedRoot) && await ownsDirectory(path, ownedChild);
}

export async function removeOwnedChild(root, ownedRoot, path, ownedChild) {
  if (await ownsChild(root, ownedRoot, path, ownedChild)) await rm(path, {recursive: true, force: true});
}
