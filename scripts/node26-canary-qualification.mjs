import {execFileSync} from 'node:child_process';
import {mkdir, cp, lstat, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {assertCleanSandbox, assertFoundationArtifact, assertNoInstalledTree, assertRuntimeMode, candidateTreeDigest, runtimeModes} from './lib/node26-canary-policy.mjs';

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
  await mkdir(workRoot, {recursive: false});
  await mkdir(evidence);
  await mkdir(state);
  const expected = assertRuntimeMode(process.version, mode);
  if ((await lstat(source)).isSymbolicLink()) throw new Error('Qualification source root must not be a symlink');
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
  const foundationArtifact = assertFoundationArtifact(
    contract,
    JSON.parse(await readFile(join(sandbox, 'package.json'), 'utf8')),
    await readFile(join(sandbox, 'pnpm-lock.yaml'), 'utf8'),
    JSON.parse(await readFile(join(sandbox, 'architecture/foundation/docs-protocol-managed-state.json'), 'utf8'))
  );
  const corepack = process.env.COREPACK_BIN ?? join(dirname(process.execPath), 'corepack');
  const version = run('package-manager-version', corepack, ['pnpm', '--version']);
  if (version.stdout.trim() !== '11.18.0') throw new Error(`Expected pnpm 11.18.0, received ${version.stdout.trim()}`);
  run('api-probe', process.execPath, ['scripts/node-api-compatibility-probe.mjs']);
  run('strict-install', corepack, [
    'pnpm',
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--ignore-pnpmfile',
    '--engine-strict',
    '--package-import-method=copy',
    '--store-dir',
    join(state, 'pnpm-store')
  ]);
  run('docs-contract-gate', corepack, ['pnpm', 'docs:protocol:check']);
  const result = {
    outcome: 'passed',
    mode,
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
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2)+'\n');
  process.stdout.write(JSON.stringify(result, null, 2)+'\n');
} catch (error) {
  const result = {
    outcome: 'blocked',
    mode,
    expectedNode: runtimeModes[mode]?.version ?? null,
    actualNode: process.version,
    source,
    candidateDigest: candidateDigest ?? null,
    candidateDigestScope: candidateDigest ? candidateDigestScope : null,
    message: error.message,
    commands
  };
  await mkdir(evidence, {recursive: true});
  await writeFile(join(evidence, 'failure.json'), JSON.stringify(result, null, 2)+'\n');
  process.stdout.write(JSON.stringify(result, null, 2)+'\n');
  process.exitCode = 1;
} finally {
  await rm(sandbox, {recursive: true, force: true});
  await rm(state, {recursive: true, force: true});
}
