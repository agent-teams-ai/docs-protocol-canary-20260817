import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  assertCleanSandbox,
  assertFoundationArtifact,
  assertNoInstalledTree,
  assertRuntimeMode,
  candidateTreeDigest
} from '../scripts/lib/node26-canary-policy.mjs';

test('retains Node 24 production and exact Node 26 canary runtimes', () => {
  assert.equal(assertRuntimeMode('24.18.0', 'production').major, 24);
  assert.equal(assertRuntimeMode('v26.10.0', 'canary').major, 26);
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

test('cannot qualify while publication is pending or artifact identity drifts from lock and managed state', async () => {
  const contract = JSON.parse(await readFile('architecture/foundation/docs-protocol-node26-qualification-v1.json', 'utf8'));
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = await readFile('pnpm-lock.yaml', 'utf8');
  const managed = JSON.parse(await readFile('architecture/foundation/docs-protocol-managed-state.json', 'utf8'));
  assert.throws(() => assertFoundationArtifact(contract, manifest, lock, managed), /pending publication/);

  // The retained artifact provides a real, already locked identity for this fixture.
  const published = structuredClone(contract);
  published.foundationArtifact.required = {
    ...published.foundationArtifact.required,
    status: 'published',
    version: published.foundationArtifact.current.version,
    integrity: published.foundationArtifact.current.integrity,
    nodeEngine: published.foundationArtifact.current.nodeEngine
  };
  const matchingManifest = structuredClone(manifest);
  matchingManifest.engines.node = published.foundationArtifact.current.nodeEngine;
  assert.equal(assertFoundationArtifact(published, matchingManifest, lock, managed).version, '1.2.0');

  const wrongVersion = structuredClone(published);
  wrongVersion.foundationArtifact.required.version = '9.9.9';
  assert.throws(() => assertFoundationArtifact(wrongVersion, matchingManifest, lock, managed), /Manifest foundation version/);
  const wrongIntegrity = structuredClone(published);
  wrongIntegrity.foundationArtifact.required.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
  assert.throws(() => assertFoundationArtifact(wrongIntegrity, matchingManifest, lock, managed), /Lockfile foundation integrity/);
  const missingIntegrity = structuredClone(published);
  missingIntegrity.foundationArtifact.required.integrity = null;
  assert.throws(() => assertFoundationArtifact(missingIntegrity, matchingManifest, lock, managed), /pending publication/);
  const wrongEngine = structuredClone(published);
  wrongEngine.foundationArtifact.required.nodeEngine = '>=24.18.0 <25 || >=26.10.0 <27';
  const matchingNewEngineManifest = structuredClone(matchingManifest);
  matchingNewEngineManifest.engines.node = wrongEngine.foundationArtifact.required.nodeEngine;
  assert.throws(() => assertFoundationArtifact(wrongEngine, matchingNewEngineManifest, lock, managed), /Lockfile foundation Node engine/);
  const missingManaged = structuredClone(managed);
  delete missingManaged.packages.engineeringFoundation;
  assert.throws(() => assertFoundationArtifact(published, matchingManifest, lock, missingManaged), /Managed foundation version/);
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
