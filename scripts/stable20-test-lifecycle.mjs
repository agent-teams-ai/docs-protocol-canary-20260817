import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, readdir, lstat} from 'node:fs/promises';
import {join} from 'node:path';

const repository = 'agent-teams-ai/docs-protocol-canary-20260817';
const source = 'f25528ac4f19fd76b0fbbe6f2f5e90ae1b0f7633';
const record = 'sha256:a2c8ac85c2f0afdaea498d5c994cb897ecabcbe6e97690dc3c5d416cd827b810';
const closure = 'sha256:24d85c7f329deedf02dd3254090b56522a3dd23e22cdd51417a9ff3bee1a8589';
const sri = 'sha512-YhgXKwsq2JlFisS+vaXBriDvbD+8wEQErMJqZCRaE4DEaZ+z+AWMgVYbpe4lTv2Zkexl4CCkVB74U3LqyUwegg==';
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.platform, 'linux');
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert.equal(process.env.GITHUB_REPOSITORY_ID, '1336577313');
assert.match(process.env.GITHUB_RUN_ID, /^[1-9][0-9]*$/);
assert.match(process.env.GITHUB_RUN_ATTEMPT, /^[1-9][0-9]*$/);
const authority = execFileSync('gh', ['api', 'repos/agent-teams-ai/.github/branches/main', '--jq', '.commit.sha'], {encoding: 'utf8'}).trim();
assert.match(authority, /^[0-9a-f]{40}$/);
const root = join(process.env.RUNNER_TEMP, `TEST-stable20-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
await mkdir(root);
const evidence = join(root, 'evidence');
await mkdir(evidence);
const consumer = join(root, 'consumer');
const controller = join(root, 'controller');
await mkdir(controller);
let sequence = 0;
function run(label, binary, args, cwd = consumer, failure = false) {
  let code = 0, stdout = '', stderr = '';
  try { stdout = execFileSync(binary, args, {cwd, encoding:'utf8', timeout:600000, maxBuffer:8*1024*1024}); }
  catch(error) {code=error.status ?? -1; stdout=String(error.stdout ?? ''); stderr=String(error.stderr ?? '');}
  execFileSync(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1],process.argv[2],{flag:"wx"})',
    join(evidence, `${++sequence}-${label}.json`), JSON.stringify({code,stdout,stderr})]);
  if(failure) assert.notEqual(code,0,`${label} unexpectedly succeeded`);
  else assert.equal(code,0,`${label}: ${stderr} ${stdout}`);
  return stdout.trim();
}
const hash = bytes => 'sha256:'+createHash('sha256').update(bytes).digest('hex');
async function inventory(prefix='') {
  const result=[];
  for(const e of await readdir(join(consumer,prefix),{withFileTypes:true})) {
    if(e.name==='node_modules'||(!prefix&&['.git','.agent-teams-local'].includes(e.name)))continue;
    const path=prefix?`${prefix}/${e.name}`:e.name;
    if(e.isDirectory())result.push(...await inventory(path));
    else {assert.ok(e.isFile()); result.push({path,hash:hash(await readFile(join(consumer,path))),mode:(await lstat(join(consumer,path))).mode&511});}
  }
  return result.sort((a,b)=>a.path.localeCompare(b.path));
}
try {
  const response=await fetch('https://registry.npmjs.org/@agent-teams/docs-protocol-agent-teams/-/docs-protocol-agent-teams-0.2.7.tgz');
  assert.ok(response.ok);const archive=Buffer.from(await response.arrayBuffer());
  assert.equal('sha512-'+createHash('sha512').update(archive).digest('base64'),sri);
  await writeFile(join(controller,'package.json'),'{"name":"test-stable20-controller","private":true}');
  await writeFile(join(controller,'controller.tgz'),archive);
  run('controller-install','npm',['install','--ignore-scripts','--package-lock=false','./controller.tgz'],controller);
  run('clone','git',['clone','--no-hardlinks',`https://github.com/${repository}.git`,consumer],root);
  run('checkout','git',['checkout','--detach',source]);
  const before=await inventory();
  run('source-install','corepack',['pnpm','install','--frozen-lockfile','--ignore-scripts','--ignore-pnpmfile','--package-import-method=copy']);
  const cli=join(controller,'node_modules/@agent-teams/docs-protocol-agent-teams/dist/cli.js');
  const managed=(label,args,failure=false)=>JSON.parse(run(label,process.execPath,[cli,...args,'--consumer',consumer,'--json'],consumer,failure));
  const installed=(label,args,failure=false)=>JSON.parse(run(label,process.execPath,[join(consumer,'node_modules/@agent-teams/docs-protocol-agent-teams/dist/cli.js'),...args,'--consumer',consumer,'--json'],consumer,failure));
  assert.equal(installed('source-current',['check']).outcome,'current');
  const rejected=installed('tamper',['apply','--expect','sha256:'+'0'.repeat(64)],true);
  assert.ok(rejected.issues.some(issue=>issue.code==='DOCS_CONSUMER_STALE_PLAN'));assert.deepEqual(await inventory(),before);
  assert.equal(installed('tamper-current',['check']).outcome,'current');
  assert.equal(installed('upgrade',['upgrade','--to','docs-2026-09-11-stable20','--target-generation','2','--authority-revision',authority]).outcome,'upgraded');
  const profile=JSON.parse(await readFile(join(consumer,'architecture/foundation/docs-consumer-integration.json')));
  assert.equal(profile.cohort.recordDigest,record);assert.equal(profile.cohort.runtime.runtimeClosureDigest,closure);
  assert.equal(managed('target-current',['check']).outcome,'current');
  run('portable-check','corepack',['pnpm','docs:protocol:check']);
  const patch=run('patch','git',['diff','--binary',source]);
  await writeFile(join(evidence,'stable20.patch'),patch+'\n');
  await writeFile(join(evidence,'integration.json'),JSON.stringify(profile,null,2)+'\n');
  await writeFile(join(evidence,'target-lock.yaml'),await readFile(join(consumer,'pnpm-lock.yaml')));
  run('identity-name','git',['config','user.name','TEST lifecycle']);run('identity-email','git',['config','user.email','test@example.invalid']);
  run('stage','git',['add','--all']);run('checkpoint','git',['commit','-m','test: stable20 disposable checkpoint']);
  assert.equal(installed('rollback',['upgrade','--to','docs-2026-09-10-stable19','--target-generation','2','--authority-revision',authority]).outcome,'upgraded');
  assert.equal(installed('rollback-current',['check']).outcome,'current');
  assert.deepEqual(await inventory(),before);
  await writeFile(join(evidence,'result.json'),JSON.stringify({outcome:'passed',source,authority,record,closure,patchDigest:hash(Buffer.from(patch+'\n')),rollbackExact:true,tamperRefused:true})+'\n');
} catch(error) {await writeFile(join(evidence,'failure.json'),JSON.stringify({message:error.message,stack:error.stack})+'\n');throw error;}
