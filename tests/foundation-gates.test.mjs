import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = fileURLToPath(import.meta.resolve('@agent-teams/engineering-foundation/package.json'));
const cli = join(dirname(manifest), JSON.parse(readFileSync(manifest)).bin['agent-teams-foundation']);
const config = 'foundation.config.yaml';
const policy = 'architecture/foundation/local-references.yaml';
const index = 'docs/decisions/README.md';
const expectedConfig = 'schemaVersion: 1\nproject: {id: docs-protocol-canary}\ncapabilities:\n  documentation.local-references:\n    configPath: architecture/foundation/local-references.yaml\n';
const expectedPolicy = 'schemaVersion: 1\nmarkdownRoots: [docs/decisions]\nanchorProfile: github\n';
const decisions = [
  'generated/0001-managed-docs-protocol-canary-qualification.md',
  'generated/0002-rc1-cohort-canary-validation.md',
  'generated/0003-rc2-cohort-canary-validation.md',
  'generated/0004-stable2-cohort-canary-validation.md',
  'generated/0005-stable3-cohort-canary-validation.md'
];
const read = (directory, path) => readFileSync(join(directory, path), 'utf8');
function contract(directory) {
  // Consumer adoption guard: a green aggregate cannot silently replace or narrow this policy.
  assert.equal(read(directory, config), expectedConfig);
  assert.equal(read(directory, policy), expectedPolicy);
  const files = readdirSync(join(directory, 'docs/decisions'), { recursive: true })
    .filter(p => p.endsWith('.md')).sort();
  assert.deepEqual(files, ['README.md', ...decisions].sort());
  assert.deepEqual([...read(directory, index).matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]), decisions);
}
function check(directory) {
  const result = spawnSync(process.execPath, [cli, 'check', '--format', 'json'],
    { cwd: directory, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { code: result.status, report: JSON.parse(result.stdout) };
}
function passing(directory) {
  const result = check(directory);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.report.outcome, 'passed');
  assert.equal(result.report.coverage, 'full');
  assert.deepEqual(result.report.capabilities.map(c => [c.capabilityId, c.capabilityConfigSchemaVersion, c.outcome]),
    [['documentation.local-references', 1, 'passed']]);
  return result;
}
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'canary-foundation-'));
  try {
    for (const p of [config, 'architecture', 'docs']) cpSync(join(root, p), join(directory, p), { recursive: true });
    contract(directory);
    passing(directory);
    run(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('adopted full capability and exact six-document/five-link universe', () => {
  contract(root);
  passing(root);
});
for (const [rule, target] of [
  ['broken-link', 'generated/missing.md'],
  ['missing-anchor', decisions[0] + '#definitely-missing-anchor'],
  ['repository-escape', '../../../outside-canary.md']
]) test(`installed full CLI rejects ${rule} and accepts restored bytes`, () => fixture(directory => {
  const original = read(directory, index);
  writeFileSync(join(directory, index), original.replace(decisions[0], target));
  const result = check(directory);
  assert.equal(result.code, 1, JSON.stringify(result));
  assert.ok(result.report.capabilities.flatMap(c => c.diagnostics)
    .some(d => d.ruleId === `documentation.local-references.${rule}`), JSON.stringify(result));
  writeFileSync(join(directory, index), original);
  for (const p of [index, ...decisions.map(p => `docs/decisions/${p}`)]) assert.equal(read(directory, p), read(root, p));
  passing(directory);
}));

test('new canonical generated decision automatically enters link scope', () => fixture(directory => {
  const p = join(directory, 'docs/decisions/generated/new-decision.md');
  writeFileSync(p, '# New decision\n\n[broken](missing.md)\n');
  const result = check(directory);
  assert.equal(result.code, 1);
  assert.ok(result.report.capabilities.flatMap(c => c.diagnostics).some(d => d.ruleId === 'documentation.local-references.broken-link'));
  rmSync(p);
  passing(directory);
}));

for (const variant of ['missing-config', 'empty-capabilities', 'removed-capability', 'narrowed-roots']) {
  test(`adoption gate rejects ${variant}`, () => fixture(directory => {
    if (variant === 'missing-config') rmSync(join(directory, config));
    if (variant === 'empty-capabilities') writeFileSync(join(directory, config), 'schemaVersion: 1\nproject: {id: docs-protocol-canary}\ncapabilities: {}\n');
    if (variant === 'removed-capability') writeFileSync(join(directory, config), 'schemaVersion: 1\nproject: {id: docs-protocol-canary}\n');
    if (variant === 'narrowed-roots') {
      mkdirSync(join(directory, 'empty'));
      writeFileSync(join(directory, policy), expectedPolicy.replace('docs/decisions', 'empty'));
      passing(directory); // Demonstrate why a separate consumer scope assertion is required.
    }
    assert.throws(() => contract(directory));
    if (variant !== 'narrowed-roots') {
      const result = check(directory);
      assert.equal(result.code, 2, JSON.stringify(result));
      if (variant === 'missing-config') assert.match(JSON.stringify(result.report), /CONFIG_FILE_UNAVAILABLE/);
    }
    writeFileSync(join(directory, config), expectedConfig);
    writeFileSync(join(directory, policy), expectedPolicy);
    contract(directory);
    passing(directory);
  }));
}

test('full gate retains all package assertions, capabilities and migrated Docs; CI invokes it', () => {
  const { scripts } = JSON.parse(read(root, 'package.json'));
  for (const name of ['check', 'status', 'attach', 'detach', 'assert-dev-only', 'assert-registry'])
    assert.equal(scripts[`foundation:${name}`], `agent-teams-foundation ${name}`);
  assert.equal(scripts.check, 'pnpm foundation:assert-dev-only && pnpm foundation:assert-registry && pnpm foundation:check && pnpm test:foundation-gates && pnpm docs:protocol:check');
  assert.equal(scripts['test:foundation-gates'], 'node --test tests/foundation-gates.test.mjs');
  assert.equal(scripts['docs:protocol:check'], 'pnpm docs:check && pnpm test:migration');
  const ci = read(root, '.github/workflows/ci.yml');
  for (const text of ['pull_request:', 'merge_group:', 'branches: [main]', 'pnpm install --frozen-lockfile', 'run: pnpm check']) assert.ok(ci.includes(text));
  assert.doesNotMatch(ci, /continue-on-error|paths-ignore|\bif:/);
});
