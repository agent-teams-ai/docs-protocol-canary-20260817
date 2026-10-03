import {execFileSync} from 'node:child_process';
import {mkdir, cp, lstat, readFile, realpath, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {acquireDirectory, assertCleanSandbox, assertFoundationArtifact, assertNoInstalledTree, assertPublicationFixture, assertRuntimeMode, candidateTreeDigest, loadPolicyTools, ownsChild, ownsDirectory, removeOwnedChild, runtimeModes} from './lib/node26-canary-policy.mjs';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
  return value;
}

const mode = option('mode', 'canary');
const source = resolve(option('source', process.cwd()));
const contractPath = resolve(source, option('contract', 'architecture/foundation/docs-protocol-node26-qualification-v1.json'));
const workBase = process.env.RUNNER_TEMP ?? tmpdir();
const workRoot = resolve(option('work-root', join(workBase, `docs-protocol-${mode}-qualification-${process.pid}-${Date.now()}`)));
const sandbox = join(workRoot, 'consumer');
const evidence = join(workRoot, 'evidence');
const state = join(workRoot, 'state');
const commands = [];
const candidateDigestScope = 'copied source tree before install, excluding .git and node_modules';
let candidateDigest;
let ownedRoot;
let ownedEvidence;
let ownedSandbox;
let ownedState;

async function stillOwnsRoot() {
  return ownsDirectory(workRoot, ownedRoot);
}

async function stillOwnsChild(path, owned) {
  return ownsChild(workRoot, ownedRoot, path, owned);
}

function run(label, binary, args, cwd = sandbox) {
  try {
    const stdout = execFileSync(binary, args, {
      cwd,
      encoding: 'utf8',
      timeout: 600000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        COREPACK_HOME: join(state, 'corepack'),
        PNPM_HOME: join(state, 'pnpm-home'),
        PNPM_STORE_DIR: join(state, 'pnpm-store'),
        XDG_CACHE_HOME: join(state, 'cache'),
        npm_config_cache: join(state, 'npm-cache')
      }
    });
    const result = {label, binary, args, cwd, code: 0, stdout, stderr: ''};
    commands.push(result);
    return result;
  } catch (error) {
    const result = {
      label,
      binary,
      args,
      cwd,
      code: error.status ?? -1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? error.message)
    };
    commands.push(result);
    throw Object.assign(new Error(`${label} failed with exit ${result.code}`), {result});
  }
}

try {
  if ((await lstat(source)).isSymbolicLink()) throw new Error('Qualification source root must not be a symlink');
  if (await realpath(source) !== source || await realpath(dirname(workRoot)) !== dirname(workRoot)) {
    throw new Error('Qualification source and work-root parent must not traverse symlinks');
  }
  const rootRelative = relative(source, workRoot);
  if (!rootRelative || (rootRelative !== '..' && !rootRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rootRelative))) {
    throw new Error('Qualification work root must be outside the source tree');
  }
  await mkdir(workRoot, {recursive: false});
  ownedRoot = await acquireDirectory(workRoot);
  await mkdir(evidence);
  ownedEvidence = await acquireDirectory(evidence);
  await mkdir(state);
  ownedState = await acquireDirectory(state);
  await mkdir(sandbox);
  ownedSandbox = await acquireDirectory(sandbox);
  const expected = assertRuntimeMode(process.version, mode);
  await assertNoInstalledTree(source);
  const contractRelative = relative(source, contractPath);
  if (!contractRelative || contractRelative === '..' || contractRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(contractRelative)) {
    throw new Error('Qualification contract must be inside the source tree');
  }
  await cp(source, sandbox, {
    recursive: true,
    filter: path => {
      const relative = path.slice(source.length).replace(/^[/\\]/, '');
      return !relative.split(/[/\\]/).some(part => ['.git', 'node_modules'].includes(part));
    }
  });
  await assertCleanSandbox(sandbox);
  candidateDigest = await candidateTreeDigest(sandbox);
  const contract = JSON.parse(await readFile(join(sandbox, contractRelative), 'utf8'));
  if (contract.runtime.production.version !== runtimeModes.production.version) throw new Error('Production runtime contract drifted');
  if (contract.runtime.canary.version !== runtimeModes.canary.version) throw new Error('Canary runtime contract drifted');
  if (!contract.runtime.skippedMajors.includes(25)) throw new Error('Node 25 must remain skipped');
  if (!contract.runtime.cutover.requiresNode26Lts || !contract.runtime.cutover.requiresOwnerAuthorization) {
    throw new Error('Node 26 cutover gates must remain explicit');
  }
  if (contract.qualification.peerValidation !== 'pnpm peers check --lockfile-only') {
    throw new Error('Locked peer validation contract drifted');
  }
  const corepack = process.env.COREPACK_BIN ?? join(dirname(process.execPath), 'corepack');
  const version = run('package-manager-version', corepack, ['pnpm', '--version']);
  if (version.stdout.trim() !== '11.18.0') throw new Error(`Expected pnpm 11.18.0, received ${version.stdout.trim()}`);
  run('api-probe', process.execPath, ['scripts/node-api-compatibility-probe.mjs']);
  // This installation is a separate published-package fixture. It never
  // substitutes its manifest/lock for the selected managed consumer's files.
  const packages = join(state, 'public-packages');
  await mkdir(packages);
  const fixture = contract.packageCompatibility;
  if (fixture.manifest !== 'scripts/node26-public-packages/manifest.json' ||
      fixture.lockfile !== 'scripts/node26-public-packages/locked-dependencies.yaml') {
    throw new Error('Publication fixture paths drifted');
  }
  await cp(join(sandbox, fixture.manifest), join(packages, 'package.json'));
  await cp(join(sandbox, fixture.lockfile), join(packages, 'pnpm-lock.yaml'));
  await cp(join(sandbox, 'scripts/node26-public-packages/pnpm-workspace.yaml'), join(packages, 'pnpm-workspace.yaml'));
  const install = [
    'pnpm', 'install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile',
    '--engine-strict', '--strict-peer-dependencies', '--package-import-method=copy',
    '--store-dir', join(state, 'pnpm-store')
  ];
  run('published-package-strict-install', corepack, install, packages);
  run('published-package-locked-peer-check', corepack, ['pnpm', 'peers', 'check', '--lockfile-only'], packages);
  const tools = loadPolicyTools(packages);
  const runtime = {node: process.versions.node, pnpm: version.stdout.trim()};
  const publishedPackages = assertPublicationFixture(contract,
    JSON.parse(await readFile(join(packages, 'package.json'), 'utf8')),
    await readFile(join(packages, 'pnpm-lock.yaml'), 'utf8'), runtime, tools);
  const policyDocument = tools.parseDocument(await readFile(join(packages, 'pnpm-workspace.yaml'), 'utf8'),
    {uniqueKeys: true, strict: true});
  if (policyDocument.errors.length) throw new Error('Invalid publication fixture policy YAML');
  const fixturePolicy = policyDocument.toJS({maxAliasCount: 0});
  const ageExclusions = publishedPackages
    .filter(coordinate => ['@agent-teams/engineering-foundation', '@agent-teams/docs-protocol-agent-teams'].includes(coordinate.package))
    .map(coordinate => `${coordinate.package}@${coordinate.version}`).sort();
  if (!fixturePolicy || Object.keys(fixturePolicy).join() !== 'minimumReleaseAgeExclude' ||
      ageExclusions.length !== 2 || !Array.isArray(fixturePolicy.minimumReleaseAgeExclude) ||
      JSON.stringify([...fixturePolicy.minimumReleaseAgeExclude].sort()) !== JSON.stringify(ageExclusions)) {
    throw new Error('Publication fixture release-age exceptions must match only the qualified Foundation and adapter coordinates');
  }
  let foundationArtifact;
  const selected = JSON.parse(await readFile(join(sandbox, 'architecture/foundation/docs-protocol-managed-state.json'), 'utf8'));
  if (mode === 'package-compatibility') {
    await cp(join(sandbox, 'scripts/node26-public-package-probe.mts'), join(packages, 'probe.mts'));
    await cp(join(sandbox, 'scripts/node26-public-packages/tsconfig.json'), join(packages, 'tsconfig.json'));
    const compiler = JSON.parse(await readFile(join(packages, 'node_modules/typescript/package.json'), 'utf8'));
    const nodeTypes = JSON.parse(await readFile(join(packages, 'node_modules/@types/node/package.json'), 'utf8'));
    if (compiler.version !== '7.0.2' || nodeTypes.version !== '26.6.4') {
      throw new Error('Publication fixture typecheck dependency pins drifted');
    }
    run('public-probe-strict-typecheck', join(packages, 'node_modules/.bin/tsc'),
      ['--noEmit', '--project', 'tsconfig.json'], packages);
    // The managed reader requires a Git root; its read-only denial uses the
    // original checkout. The portable check below uses the digested fresh copy.
    run('public-sdk-and-managed26-denial', process.execPath, ['probe.mts', source], packages);
    run('portable-docs-package-gate', corepack, ['pnpm', 'exec', 'agent-teams-docs', 'check',
      '--consumer', sandbox, '--profile', 'architecture/foundation/docs-protocol.yaml'], packages);
  } else {
    foundationArtifact = assertFoundationArtifact(contract,
      JSON.parse(await readFile(join(sandbox, 'package.json'), 'utf8')),
      await readFile(join(sandbox, 'pnpm-lock.yaml'), 'utf8'), selected, mode, tools, runtime);
    run('strict-install', corepack, install);
    run('locked-peer-check', corepack, ['pnpm', 'peers', 'check', '--lockfile-only']);
    run('docs-contract-gate', corepack, ['pnpm', 'docs:protocol:check']);
  }
  const result = {
    outcome: 'passed',
    mode,
    evidenceClass: mode === 'package-compatibility' ? 'public-package-compatibility' : 'managed-candidate-runner-supporting',
    managedQualification: false,
    selectedConsumerCohort: selected.cohortId,
    publishedPackages,
    publicationFixturePolicy: fixturePolicy,
    expectedNode: expected.version,
    actualNode: process.version,
    packageManager: version.stdout.trim(),
    source,
    candidateDigest,
    candidateDigestScope,
    contract: contract.contract,
    foundationArtifact,
    isolated: true,
    reusedNodeModules: false,
    commands
  };
  if (!await stillOwnsChild(evidence, ownedEvidence)) throw new Error('Qualification evidence ownership was lost');
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2)+'\n');
  process.stdout.write(JSON.stringify(result, null, 2)+'\n');
} catch (error) {
  const result = {
    outcome: 'blocked',
    mode,
    evidenceClass: mode === 'package-compatibility' ? 'public-package-compatibility' : 'managed-candidate-runner-supporting',
    managedQualification: false,
    expectedNode: runtimeModes[mode]?.version ?? null,
    actualNode: process.version,
    source,
    candidateDigest: candidateDigest ?? null,
    candidateDigestScope: candidateDigest ? candidateDigestScope : null,
    message: error.message,
    commands
  };
  if (await stillOwnsRoot()) {
    if (!ownedEvidence) {
      try {
        await mkdir(evidence);
        ownedEvidence = await acquireDirectory(evidence);
      } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
    }
    if (await stillOwnsChild(evidence, ownedEvidence)) {
      await writeFile(join(evidence, 'failure.json'), JSON.stringify(result, null, 2)+'\n');
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2)+'\n');
  process.exitCode = 1;
} finally {
  try {
    await removeOwnedChild(workRoot, ownedRoot, sandbox, ownedSandbox);
  } finally {
    await removeOwnedChild(workRoot, ownedRoot, state, ownedState);
  }
}
