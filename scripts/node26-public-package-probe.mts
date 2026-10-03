// Copied into the separately installed publication fixture for native ESM
// resolution. This executes released public APIs; it issues no mutation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {inspectFoundationPackage} from '@agent-teams/engineering-foundation';
import {ConsumerIntegrationNodeError, readConsumerIntegrationInput} from '@agent-teams/docs-protocol-agent-teams';

assert.equal(process.version, 'v26.10.0');
const consumerRootArgument = process.argv[2];
if (consumerRootArgument === undefined || consumerRootArgument.length === 0) {
  throw new Error('Usage: node probe.mts <consumer-root>');
}
const consumerRoot = resolve(consumerRootArgument);
const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('@agent-teams/engineering-foundation/package.json'));
const foundation = await inspectFoundationPackage(packageRoot);
assert.equal(foundation.packageVersion, '1.7.2');
assert.equal(foundation.metadataSchemaVersion, 1);
assert.equal(foundation.localModeProtocolVersion, 1);
let denial: {readonly code: 'DOCS_CONSUMER_UNSUPPORTED_NODE'; readonly message: string} | undefined;
try {
  await readConsumerIntegrationInput({consumerRoot});
} catch (error: unknown) {
  if (!(error instanceof ConsumerIntegrationNodeError) || error.code !== 'DOCS_CONSUMER_UNSUPPORTED_NODE') throw error;
  denial = {code: error.code, message: error.message};
}
assert.ok(denial, 'Released adapter unexpectedly admitted managed Node26');
process.stdout.write(JSON.stringify({node: process.version, foundation, managed26Denial: denial,
  evidenceClass: 'public-package-compatibility', managedQualification: false}) + '\n');
