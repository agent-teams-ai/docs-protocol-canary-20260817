import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  assertCleanSandbox,
  assertNoInstalledTree,
  assertRuntimeMode
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
