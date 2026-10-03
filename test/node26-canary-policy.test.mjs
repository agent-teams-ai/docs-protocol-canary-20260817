import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {
  acquireDirectory,
  assertCleanSandbox,
  assertFoundationArtifact,
  assertNoInstalledTree,
  assertRuntimeMode,
  assertPublicationFixture,
  assertRange,
  candidateTreeDigest,
  loadPolicyTools,
  ownsChild,
  parseLockfile,
  removeOwnedChild
} from '../scripts/lib/node26-canary-policy.mjs';

const tools = loadPolicyTools(process.env.NODE26_POLICY_TOOLS);
const contract = JSON.parse(await readFile('architecture/foundation/docs-protocol-node26-qualification-v1.json', 'utf8'));


test('retains Node 24 production and exact Node 26 canary runtimes', () => {
  assert.equal(assertRuntimeMode('24.18.0', 'production').major, 24);
  assert.equal(assertRuntimeMode('v26.10.0', 'canary').major, 26);
  assert.equal(assertRuntimeMode('v26.10.0', 'package-compatibility').major, 26);
});

test('rejects the skipped Node 25 line and qualification version drift', () => {
  assert.throws(() => assertRuntimeMode('25.0.0', 'canary'), /requires Node 26\.10\.0/);
  assert.throws(() => assertRuntimeMode('24.17.0', 'production'), /requires Node 24\.18\.0/);
  assert.throws(() => assertRuntimeMode('26.9.0', 'canary'), /requires Node 26\.10\.0/);
});

test('rejects reused installations and Git metadata in qualification sandboxes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'node26-sandbox-policy-'));
  try {
    await assertNoInstalledTree(root);
    await assertCleanSandbox(root);
    await mkdir(join(root, 'node_modules'));
    await assert.rejects(assertNoInstalledTree(root), /must not contain node_modules/);
    await rm(join(root, 'node_modules'), {recursive: true});
    await mkdir(join(root, '.git'));
    await assert.rejects(assertCleanSandbox(root), /must not contain \.git/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('runs the observable Node API compatibility probe', () => {
  const output = execFileSync(process.execPath, ['scripts/node-api-compatibility-probe.mjs'], {
    encoding: 'utf8'
  });
  const result = JSON.parse(output);
  assert.equal(result.outcome, 'passed');
  assert.equal(result.node, process.version);
  assert.ok(result.apis.includes('fs/promises'));
  assert.ok(result.apis.includes('fetch'));
});

// Synthetic admission inputs only, never generated consumer postimages or
// publication/qualification evidence. SRIs and package ranges are the supplied
// immutable releases; range parsing is performed by the real declared library.
function publicationInput() {
  const coordinates = [{...contract.foundationArtifact.required, package: '@agent-teams/engineering-foundation',
    managedKey: 'engineeringFoundation', direct: true}, ...contract.foundationArtifact.publishedDependencies,
    ...contract.policyTools.map(c => ({...c, direct: true}))];
  const manifest = {engines: {node: '>=24.18.0 <25 || >=26.10.0 <27', pnpm: '>=11.17.0 <12'}, devDependencies: {}};
  const lock = {lockfileVersion: '9.0', importers: {'.': {devDependencies: {}}}, packages: {}, snapshots: {}};
  const managed = {cohortId: 'docs-2026-10-03-stable31', runtime: {node: '>=24.18.0 <25', pnpm: '>=11.17.0 <12'}, packages: {}};
  for (const c of coordinates) {
    if (c.direct) {
      manifest.devDependencies[c.package] = c.version;
      lock.importers['.'].devDependencies[c.package] = {specifier: c.version, version: c.version};
    }
    lock.packages[`${c.package}@${c.version}`] = {resolution: {integrity: c.integrity},
      engines: {node: c.nodeEngine, ...(c.pnpmEngine ? {pnpm: c.pnpmEngine} : {})}};
    lock.snapshots[`${c.package}@${c.version}`] = {dependencies: {}};
    if (c.managedKey) managed.packages[c.managedKey] = {version: c.version, integrity: c.integrity};
  }
  for (const [from, to] of contract.packageCompatibility.internalEdges) {
    const a = coordinates.find(c => c.package === from), b = coordinates.find(c => c.package === to);
    lock.snapshots[`${from}@${a.version}`].dependencies[to] = b.version;
  }
  return {manifest, lock, managed};
}

test('retained real stable20 admits Node24 despite different consumer and package ranges', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = await readFile('pnpm-lock.yaml', 'utf8');
  const managed = JSON.parse(await readFile('architecture/foundation/docs-protocol-managed-state.json', 'utf8'));
  assert.equal(assertFoundationArtifact(contract, manifest, lock, managed, 'production', tools).version, '1.2.0');
  assert.throws(() => assertFoundationArtifact(contract, manifest, lock, managed, 'canary', tools), /Manifest foundation version/);
});

test('released stable31 package support admits runtime26 but preserves real managed24 restriction', () => {
  const {manifest, lock, managed} = publicationInput();
  const runtime = {node: '26.10.0', pnpm: '11.18.0'};
  assert.equal(assertPublicationFixture(contract, manifest, JSON.stringify(lock), runtime, tools).length, 5);
  const plainEngine = JSON.stringify(lock).replaceAll(
    JSON.stringify({node: '^24.18.0 || ^26.0.0', pnpm: '>=11.17.0 <12'}),
    "{node: ^24.18.0 || ^26.0.0, pnpm: '>=11.17.0 <12'}");
  assert.equal(assertPublicationFixture(contract, manifest, plainEngine, runtime, tools).length, 5);
  assert.equal(assertFoundationArtifact(contract, manifest, JSON.stringify(lock), managed, 'production', tools).version, '1.7.2');
  assert.throws(() => assertFoundationArtifact(contract, manifest, JSON.stringify(lock), managed, 'canary', tools), /Released managed check Node engine/);
  managed.runtime.node = '>=26.0.0 <27';
  assert.throws(() => assertFoundationArtifact(contract, manifest, JSON.stringify(lock), managed, 'canary', tools), /Released managed check Node engine/);
});

test('pending publication and missing managed identity are rejected before managed runtime admission', () => {
  const f = publicationInput();
  const pending = structuredClone(contract); pending.foundationArtifact.required.status = 'pending-publication';
  assert.throws(() => assertFoundationArtifact(pending, f.manifest, JSON.stringify(f.lock), f.managed, 'canary', tools), /pending publication/);
  const missing = structuredClone(contract); missing.foundationArtifact.required.integrity = null;
  assert.throws(() => assertFoundationArtifact(missing, f.manifest, JSON.stringify(f.lock), f.managed, 'canary', tools), /pending publication/);
  delete f.managed.packages.engineeringFoundation;
  assert.throws(() => assertFoundationArtifact(contract, f.manifest, JSON.stringify(f.lock), f.managed, 'canary', tools), /Managed foundation version/);
});

test('real ranges handle caret, alternatives, hyphens, wildcards, bounds and prerelease rejection', () => {
  for (const [version, range] of [['26.0.0', '^24.18.0 || ^26.0.0'], ['24.19.2', '24.18 - 24.21'],
    ['26.10.0', '26.x'], ['11.18.0', '>=11.17.0 <12']]) assert.doesNotThrow(() => assertRange(version, range, 'engine', tools));
  for (const [version, range] of [['24.17.9', '^24.18.0'], ['25.0.0', '^24.18.0 || ^26.0.0'],
    ['26.9.0', '>=26.10.0 <27'], ['26.10.0-rc.1', '^26.0.0'], ['26.10.0', 'not a range'],
    ['26.10.0', ''], ['11.18.0', '>=12']]) assert.throws(() => assertRange(version, range, 'engine', tools), /rejects runtime/);
});

test('consumer, locked package, and managed runtime ranges independently reject execution', () => {
  const {manifest, lock, managed} = publicationInput();
  manifest.engines.node = '^26.0.0';
  assert.throws(() => assertFoundationArtifact(contract, manifest, JSON.stringify(lock), managed, 'production', tools), /Consumer Node engine/);
  manifest.engines.node = '>=24.18.0 <25 || >=26.10.0 <27';
  lock.packages['@agent-teams/engineering-foundation@1.7.2'].engines.node = '^26.0.0';
  assert.throws(() => assertFoundationArtifact(contract, manifest, JSON.stringify(lock), managed, 'production', tools), /Lockfile.*Node engine/);
  lock.packages['@agent-teams/engineering-foundation@1.7.2'].engines.node = '^24.18.0 || ^26.0.0';
  managed.runtime.node = '^26.0.0';
  assert.throws(() => assertFoundationArtifact(contract, manifest, JSON.stringify(lock), managed, 'production', tools), /Selected managed Node engine/);
});

test('peer-qualified root locators require matching snapshots and preserve exact SRI and versions', () => {
  const {manifest, lock} = publicationInput();
  const key = '@agent-teams/engineering-foundation@1.7.2';
  const locator = '1.7.2(@types/node@24.13.3(peer@1.0.0))';
  lock.importers['.'].devDependencies['@agent-teams/engineering-foundation'].version = locator;
  lock.snapshots[`@agent-teams/engineering-foundation@${locator}`] = lock.snapshots[key];
  delete lock.snapshots[key];
  const admit = () => assertPublicationFixture(contract, manifest, JSON.stringify(lock), {node: '26.10.0', pnpm: '11.18.0'}, tools);
  assert.equal(admit().find(c => c.package === '@agent-teams/engineering-foundation').version, '1.7.2');
  for (const invalid of ['1.7.2()', '1.7.2(peer@1.0.0', '1.7.2(peer@1.0.0))', '1.7.2(peer @1)', '1.7.2(peer@1)tail', '1.7.3', 'file:artifact.tgz']) {
    lock.importers['.'].devDependencies['@agent-teams/engineering-foundation'].version = invalid;
    assert.throws(admit, /locator/);
  }
  lock.importers['.'].devDependencies['@agent-teams/engineering-foundation'].version = locator;
  delete lock.snapshots[`@agent-teams/engineering-foundation@${locator}`];
  assert.throws(admit, /root snapshot/);
});

test('identity, registry, direct roots, internal edges, and selected state cannot drift', () => {
  for (const [change, expected] of [
    [f => f.manifest.devDependencies['@agent-teams/engineering-foundation'] = '^1.7.2', /Manifest foundation version/],
    [f => f.lock.importers['.'].devDependencies['@agent-teams/engineering-foundation'].specifier = '^1.7.2', /specifier/],
    [f => f.lock.packages['@agent-teams/engineering-foundation@1.7.2'].resolution.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`, /integrity/],
    [f => f.lock.packages['@agent-teams/engineering-foundation@1.7.2'].resolution.tarball = 'file:untrusted.tgz', /Non-registry/],
    [f => f.managed.packages.docsProtocol.integrity = 'wrong', /Managed.*integrity/],
    [f => f.managed.cohortId = 'docs-2026-09-11-stable20', /Managed cohort/]
  ]) {
    const f = publicationInput(); change(f);
    assert.throws(() => assertFoundationArtifact(contract, f.manifest, JSON.stringify(f.lock), f.managed, 'canary', tools), expected);
  }
  const f = publicationInput(); f.lock.snapshots['@agent-teams/docs-protocol@0.6.2'].dependencies['@agent-teams/repository-mutation'] = '0.2.0';
  assert.throws(() => assertPublicationFixture(contract, f.manifest, JSON.stringify(f.lock), {node: '26.10.0', pnpm: '11.18.0'}, tools), /locator/);
});

test('real YAML rejects duplicate fields, malformed documents, and non-root importers', () => {
  assert.throws(() => parseLockfile("lockfileVersion: '9.0'\nimporters: {.: {}}\nimporters: {.: {}}\n", tools), /Invalid lockfile YAML/);
  assert.throws(() => parseLockfile('packages: [unterminated', tools), /Invalid lockfile YAML/);
  assert.throws(() => parseLockfile("lockfileVersion: '9.0'\nimporters: {.: {}, child: {}}\n", tools), /exactly one root importer/);
});

test('exclusive work-root collision preserves existing consumer, state, and evidence bytes', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'node26-work-root-collision-'));
  try {
    const source = join(fixture, 'source');
    const workRoot = join(fixture, 'occupied');
    await mkdir(source);
    for (const directory of ['consumer', 'state', 'evidence']) {
      await mkdir(join(workRoot, directory), {recursive: true});
      await writeFile(join(workRoot, directory, 'sentinel'), `${directory}-owned-by-another-run`);
    }
    const result = spawnSync(process.execPath, [resolve('scripts/node26-canary-qualification.mjs'), '--source', source, '--work-root', workRoot], {encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).message, /EEXIST/);
    for (const directory of ['consumer', 'state', 'evidence']) {
      assert.equal(await readFile(join(workRoot, directory, 'sentinel'), 'utf8'), `${directory}-owned-by-another-run`);
    }
    await assert.rejects(readFile(join(workRoot, 'evidence', 'failure.json')));
  } finally {
    await rm(fixture, {recursive: true, force: true});
  }
});

test('symlinked work root has no effects on its target', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'node26-work-root-link-'));
  try {
    const source = join(fixture, 'source');
    const target = join(fixture, 'target');
    const workRoot = join(fixture, 'linked-root');
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(target, 'sentinel'), 'outside-target-bytes');
    await symlink(target, workRoot, 'dir');
    const result = spawnSync(process.execPath, [resolve('scripts/node26-canary-qualification.mjs'), '--source', source, '--work-root', workRoot], {encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).message, /EEXIST/);
    assert.equal(await readFile(join(target, 'sentinel'), 'utf8'), 'outside-target-bytes');
    assert.deepEqual(await readdir(target), ['sentinel']);
    await assert.rejects(readFile(join(target, 'evidence', 'failure.json')));
  } finally {
    await rm(fixture, {recursive: true, force: true});
  }
});

test('symlinked source and work-root parent are rejected before creating evidence', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'node26-root-parent-link-'));
  try {
    const source = join(fixture, 'source');
    const sourceLink = join(fixture, 'source-link');
    const parentLink = join(fixture, 'parent-link');
    await mkdir(source);
    await symlink(source, sourceLink, 'dir');
    await symlink(fixture, parentLink, 'dir');
    for (const [candidateSource, workRoot] of [
      [sourceLink, join(fixture, 'source-link-work')],
      [source, join(parentLink, 'parent-link-work')]
    ]) {
      const result = spawnSync(process.execPath, [resolve('scripts/node26-canary-qualification.mjs'), '--source', candidateSource, '--work-root', workRoot], {encoding: 'utf8'});
      assert.equal(result.status, 1);
      assert.match(JSON.parse(result.stdout).message, /symlink/);
    }
    assert.deepEqual((await readdir(fixture)).sort(), ['parent-link', 'source', 'source-link']);
  } finally {
    await rm(fixture, {recursive: true, force: true});
  }
});

test('cleanup releases owned children and preserves foreign child, root, and evidence replacements', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'node26-owned-cleanup-'));
  try {
    for (const replace of ['none', 'consumer', 'state', 'evidence', 'root', 'symlink']) {
      const root = join(fixture, replace); await mkdir(root);
      const rootOwner = await acquireDirectory(root);
      const children = {};
      for (const name of ['consumer', 'state', 'evidence']) {
        const path = join(root, name); await mkdir(path);
        children[name] = {path, owner: await acquireDirectory(path)};
      }
      const name = replace === 'symlink' ? 'consumer' : replace;
      const target = replace === 'root' ? root : children[name]?.path;
      if (target) {
        await rename(target, target + '-former');
        if (replace === 'symlink') {
          const foreign = join(fixture, 'foreign'); await mkdir(foreign);
          await writeFile(join(foreign, 'sentinel'), 'foreign'); await symlink(foreign, target, 'dir');
        } else {
          await mkdir(target); await writeFile(join(target, 'sentinel'), 'foreign');
        }
      }
      for (const child of ['consumer', 'state']) {
        const {path, owner} = children[child];
        await removeOwnedChild(root, rootOwner, path, owner);
        if (replace === 'root' || child === name) {
          assert.equal(await readFile(join(target, 'sentinel'), 'utf8'), 'foreign');
        } else await assert.rejects(lstat(path), {code: 'ENOENT'});
      }
      const evidence = children.evidence;
      assert.equal(await ownsChild(root, rootOwner, evidence.path, evidence.owner), !['root', 'evidence'].includes(replace));
      if (replace === 'evidence') assert.deepEqual(await readdir(evidence.path), ['sentinel']);
    }
  } finally { await rm(fixture, {recursive: true, force: true}); }
});

test('real runner failure cleans its fresh consumer and state while retaining failure evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'node26-runner-cleanup-'));
  try {
    const source = join(root, 'source'); await mkdir(source);
    const workRoot = join(root, 'work');
    const result = spawnSync(process.execPath, [resolve('scripts/node26-canary-qualification.mjs'),
      '--mode', 'unsupported', '--source', source, '--work-root', workRoot], {encoding: 'utf8'});
    assert.equal(result.status, 1, result.stderr);
    const failure = JSON.parse(await readFile(join(workRoot, 'evidence', 'failure.json'), 'utf8'));
    assert.match(failure.message, /Unsupported qualification mode/);
    assert.deepEqual(await readdir(workRoot), ['evidence']);
    assert.deepEqual(await readdir(source), []);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('rejects copied symlinks, including escapes, and binds candidate digest to file bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'node26-candidate-policy-'));
  const outside = await mkdtemp(join(tmpdir(), 'node26-candidate-outside-'));
  try {
    await writeFile(join(root, 'candidate.txt'), 'first');
    const first = await candidateTreeDigest(root);
    assert.equal(first, await candidateTreeDigest(root));
    await writeFile(join(root, 'candidate.txt'), 'second');
    assert.notEqual(first, await candidateTreeDigest(root));
    await writeFile(join(outside, 'secret.txt'), 'outside');
    await symlink(join(outside, 'secret.txt'), join(root, 'escape'));
    await assert.rejects(candidateTreeDigest(root), /contains symlink/);
    await symlink(join(outside, 'secret.txt'), join(root, 'node_modules'));
    await assert.rejects(assertNoInstalledTree(root), /must not contain node_modules/);
  } finally {
    await rm(root, {recursive: true, force: true});
    await rm(outside, {recursive: true, force: true});
  }
});
