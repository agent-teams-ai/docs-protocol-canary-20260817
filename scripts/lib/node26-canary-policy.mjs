import {access} from 'node:fs/promises';
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
      await access(join(root, path));
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
