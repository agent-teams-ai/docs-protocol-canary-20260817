import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'node-api-compat-'));
try {
  const source = join(root, 'source');
  const target = join(root, 'target');
  await mkdir(source);
  await writeFile(join(source, 'payload.txt'), 'node-api-compat');
  await cp(source, target, {recursive: true});
  const bytes = await readFile(join(target, 'payload.txt'));
  assert.equal(bytes.toString(), 'node-api-compat');
  assert.equal((await readdir(target)).sort().join(','), 'payload.txt');
  assert.ok((await lstat(join(target, 'payload.txt'))).isFile());
  assert.equal('sha256:'+createHash('sha256').update(bytes).digest('hex'), 'sha256:636867bb14d952d8aa07b155853198dfbd018d4521a4b507041eea91c7325943');
  assert.equal(execFileSync(process.execPath, ['-e', 'process.stdout.write("ok")'], {encoding: 'utf8'}), 'ok');
  assert.equal(typeof fetch, 'function');
  process.stdout.write(JSON.stringify({
    outcome: 'passed',
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    apis: ['assert', 'child_process', 'crypto', 'fs/promises', 'os', 'path', 'fetch']
  })+'\n');
} finally {
  await rm(root, {recursive: true, force: true});
}
