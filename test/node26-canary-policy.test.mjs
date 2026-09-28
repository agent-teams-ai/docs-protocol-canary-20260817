import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
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
  assert.deepEqual(assertFoundationArtifact(contract, manifest, lock, managed, 'production'), {
    package: '@agent-teams/engineering-foundation',
    version: contract.foundationArtifact.current.version,
    integrity: contract.foundationArtifact.current.integrity,
    nodeEngine: contract.foundationArtifact.current.nodeEngine
  });
  const wrongRetained = structuredClone(contract);
  wrongRetained.foundationArtifact.current.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
  assert.throws(() => assertFoundationArtifact(wrongRetained, manifest, lock, managed, 'production'), /Lockfile foundation integrity/);

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

test('cleanup preserves independently replaced consumer and state directories or symlinks', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'node26-child-cleanup-'));
  try {
    const runner = await readFile(resolve('scripts/node26-canary-qualification.mjs'), 'utf8');
    const seam = '  const expected = assertRuntimeMode(process.version, mode);';
    assert.equal(runner.split(seam).length, 2);
    await mkdir(join(fixture, 'scripts', 'lib'), {recursive: true});
    await cp(resolve('scripts/lib/node26-canary-policy.mjs'), join(fixture, 'scripts', 'lib', 'node26-canary-policy.mjs'));
    const source = join(fixture, 'source');
    await mkdir(source);
    for (const {name, replacement, targets} of [
      {name: 'consumer-only', replacement: 'directory', targets: ['consumer']},
      {name: 'state-only', replacement: 'directory', targets: ['state']},
      {name: 'both-directories', replacement: 'directory', targets: ['consumer', 'state']},
      {name: 'both-symlinks', replacement: 'symlink', targets: ['consumer', 'state']}
    ]) {
      const workRoot = join(fixture, `work-${name}`);
      const injection = `  {
    const fs = await import('node:fs/promises');
    for (const target of ${JSON.stringify(targets)}) {
      const original = join(workRoot, target);
      await fs.rename(original, join(workRoot, 'former-' + target));
      const foreign = join(${JSON.stringify(fixture)}, 'foreign-${name}-' + target);
      await fs.mkdir(foreign);
      await fs.writeFile(join(foreign, 'sentinel'), 'foreign-' + target);
      if ('${replacement}' === 'symlink') await fs.symlink(foreign, original, 'dir');
      else await fs.rename(foreign, original);
    }
    throw new Error('injected failure after foreign replacement');
  }
`;
      const faultRunner = join(fixture, 'scripts', `fault-${name}.mjs`);
      await writeFile(faultRunner, runner.replace(seam, injection + seam));
      const result = spawnSync(process.execPath, [faultRunner, '--source', source, '--work-root', workRoot], {encoding: 'utf8'});
      assert.equal(result.status, 1, result.stderr);
      assert.equal(JSON.parse(result.stdout).message, 'injected failure after foreign replacement');
      for (const target of ['consumer', 'state']) {
        const path = join(workRoot, target);
        if (targets.includes(target)) {
          assert.equal((await lstat(path)).isSymbolicLink(), replacement === 'symlink');
          assert.equal(await readFile(join(path, 'sentinel'), 'utf8'), `foreign-${target}`);
        } else {
          await assert.rejects(lstat(path), {code: 'ENOENT'});
        }
      }
    }
    for (const target of ['root', 'evidence']) {
      const workRoot = join(fixture, `work-replaced-${target}`);
      const path = target === 'root' ? workRoot : join(workRoot, 'evidence');
      const injection = `  {
    const fs = await import('node:fs/promises');
    await fs.rename(${JSON.stringify(path)}, ${JSON.stringify(path + '-former')});
    await fs.mkdir(${JSON.stringify(path)});
    await fs.writeFile(join(${JSON.stringify(path)}, 'sentinel'), 'foreign-${target}');
    throw new Error('injected failure after foreign replacement');
  }
`;
      const faultRunner = join(fixture, 'scripts', `fault-replaced-${target}.mjs`);
      await writeFile(faultRunner, runner.replace(seam, injection + seam));
      const result = spawnSync(process.execPath, [faultRunner, '--source', source, '--work-root', workRoot], {encoding: 'utf8'});
      assert.equal(result.status, 1, result.stderr);
      assert.equal(JSON.parse(result.stdout).message, 'injected failure after foreign replacement');
      assert.equal(await readFile(join(path, 'sentinel'), 'utf8'), `foreign-${target}`);
      if (target === 'evidence') await assert.rejects(readFile(join(path, 'failure.json')), {code: 'ENOENT'});
    }
  } finally {
    await rm(fixture, {recursive: true, force: true});
  }
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
