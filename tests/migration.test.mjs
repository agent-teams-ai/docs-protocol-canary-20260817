import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { docsCheckV2 } from '@agent-teams/docs-protocol';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');
const profilePath = 'architecture/foundation/docs-protocol.yaml';
const skillPath = '.agents/skills/docs-authoring/SKILL.md';
const check = consumerRoot => docsCheckV2({ consumerRoot, profilePath });

// Copy only consumer-owned inputs; dependencies resolve from this test's installation.
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'canary-migration-'));
  try {
    for (const p of ['AGENTS.md', '.agents', 'architecture', 'docs']) {
      cpSync(join(root, p), join(directory, p), { recursive: true });
    }
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

test('installed public check accepts the migrated consumer', async () => {
  const result = await check(root);
  assert.equal(result.exitCode, 0, JSON.stringify(result.envelope));
  assert.equal(result.envelope.outcome, 'success');
  assert.deepEqual(result.envelope.diagnostics, []);
});

for (const variant of ['missing-context', 'historical-skill']) {
  test(`installed public check rejects ${variant}`, async () => {
    const directory = fixture();
    try {
      const current = read(skillPath);
      const invalid = variant === 'historical-skill'
        ? read('tests/fixtures/migration/historical-skill.md')
        : current.replace(/^- Refresh bounded context.*\n/m, '');
      assert.notEqual(invalid, current, 'negative fixture must change the workflow');
      writeFileSync(join(directory, skillPath), invalid);
      const result = await check(directory);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.envelope.outcome, 'violation');
      assert.ok(result.envelope.diagnostics.some(d =>
        d.ruleId === 'docs.adoption.invalid' && d.severity === 'error' && d.message.includes('ordered')),
      JSON.stringify(result.envelope));
      writeFileSync(join(directory, skillPath), current);
      assert.equal((await check(directory)).exitCode, 0, 'restored workflow must pass');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('portable profile retains strict authoring and adoption contracts', () => {
  const profile = read(profilePath);
  assert.match(profile, /^schemaVersion: 3\n/);
  assert.match(profile, /path: architecture\/foundation\/document-authoring.yaml/);
  assert.match(profile, /metadataSidecarPolicy: foundation-profile-v3-strict-merge/);
  assert.match(profile, /agentWorkflow: \{adoption: portable-v1, skillPath: .agents\/skills\/docs-authoring\/SKILL.md\}/);
  assert.match(read('architecture/foundation/document-authoring.yaml'), /^schemaVersion: 3\n/);
});

test('managed roots and release-age exclusions retain exact reviewed coordinates', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.devDependencies, {
    '@agent-teams/docs-protocol': '0.6.0',
    '@agent-teams/engineering-foundation': '1.1.1',
    '@agent-teams/docs-protocol-agent-teams': '0.2.3'
  });
  assert.equal(read('pnpm-workspace.yaml'), "minimumReleaseAgeExclude:\n  - '@agent-teams/docs-protocol@0.6.0'\n  - '@agent-teams/engineering-foundation@1.1.1'\n  - \"@agent-teams/repository-mutation@0.2.0\"\n  - \"@agent-teams/document-authoring@0.3.0\"\n  - \"@agent-teams/docs-protocol-agent-teams@0.2.3\"\n");
  assert.equal(pkg.packageManager, 'pnpm@11.18.0');
  assert.equal(pkg.scripts['docs:protocol:check'], 'pnpm docs:check && pnpm test:migration');
  assert.equal(pkg.scripts['test:migration'], 'node --test tests/migration.test.mjs');
});

test('Skill preview/apply preserve inputs and use installed declared CLI aliases', () => {
  const skill = read(skillPath);
  const preview = skill.match(/`(pnpm docs:new [^`]+--dry-run)`/)[1];
  const apply = skill.match(/`(pnpm docs:new [^`]+--apply)`/)[1];
  assert.equal(preview.replace(' --dry-run', ''), apply.replace(' --apply', ''));
  for (const command of ['info', 'find', 'new', 'check'])
    assert.match(skill, new RegExp(`pnpm docs:${command}`));
  assert.match(skill, /pnpm exec docs-protocol context/);
  const manifestPath = fileURLToPath(import.meta.resolve('@agent-teams/docs-protocol/package.json'));
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(typeof bin['docs-protocol'], 'string');
  assert.equal(bin['docs-protocol'], bin['agent-teams-docs']);
  assert.ok(readFileSync(join(dirname(manifestPath), bin['docs-protocol'])).length > 0);
  assert.match(skill, /pnpm docs:protocol:check/);
  assert.match(skill, /pnpm docs:doctor.*pnpm docs:recover/);
  assert.match(skill, /supersession explicitly/);
});
