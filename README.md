# Docs Protocol Canary

Disposable organization-owned repository for Managed Docs Protocol qualification.
It contains no production runtime, customer data, or provider integration.

## Explicit Node/Corepack execution

Node26 does not bundle Corepack. Select the admitted executable explicitly and
invoke the existing Node24 Corepack JavaScript through that executable. All
installs, caches, temporary files and nested pnpm calls belong in this TEST job's
external `.scratch`, outside the source tree. Never install globally or relax
engine strictness.

```sh
selectedNode=/srv/workers/TEST-node26-11-default-tool-20261011-a1/node-v26.11.1-linux-x64/bin/node
export COREPACK_JS=/opt/nodejs/node-v24.21.0-linux-x64/lib/node_modules/corepack/dist/corepack.js
# Set taskScratch to a fresh directory in this job's external .scratch.
mkdir -p "$taskScratch/bin" "$taskScratch/tmp"
export TMPDIR="$taskScratch/tmp" COREPACK_HOME="$taskScratch/corepack"
export PNPM_HOME="$taskScratch/pnpm-home" XDG_CACHE_HOME="$taskScratch/cache"
export npm_config_cache="$taskScratch/npm-cache" PNPM_STORE_DIR="$taskScratch/store"
export selectedNode
cat > "$taskScratch/bin/pnpm" <<'SH'
#!/bin/sh
exec "$selectedNode" "$COREPACK_JS" pnpm "$@"
SH
chmod +x "$taskScratch/bin/pnpm"
ln -s "$selectedNode" "$taskScratch/bin/node"
export PATH="$taskScratch/bin:$PATH"
"$selectedNode" "$COREPACK_JS" pnpm --version # must be 11.18.0
"$selectedNode" scripts/node26-canary-qualification.mjs --mode production --work-root "$taskScratch/default"
# Retain --mode node24-compatibility with an exact Node24.18.0 executable.
```

The root public dependencies now select Foundation1.7.4, Docs0.6.2 and
adapter0.4.0, with authoring0.3.2 and mutation0.2.2 in the strict lock. All five
published packages admit Node26. This tuple is not stable31: the retained
managed selection remains stable20 and rejects the changed root identities.
Default managed qualification remains pending the owning shared runtime policy
and a legitimate generated upgrade; owner runtime selection does not fabricate
managed state, accepted ADRs or receipts.
The public stable31 fixture proves a different boundary and cannot substitute
for the required selected-consumer gate. The pinned shared documentation
workflow has no Node input and still selects24; migration of that external
cohort-owned workflow requires its owner and cannot be fabricated here.

## Node runtime runner

The runner copies a clean candidate without Git metadata or dependencies, binds
its preinstall bytes to a candidate digest, and uses an exclusive external work
root with isolated package-manager state. It preserves evidence and removes
only directories it still owns. Owner direction of 2026-10-11 supersedes the previous inactive26 cutover policy.
Use Node26.11.1 / pnpm11.18.0 for the default `production`, `canary`, and
`package-compatibility` modes; retain Node24.18.0 for `node24-compatibility`.
Node25 stays skipped. The runner defaults to `production`.

Default and Node24 compatibility admission still validate the retained managed
selection. The current root package migration is pending that generated upgrade;
the historical stable20 Node24 admission remains covered by exact retained fixtures.
It checks immutable five-package identities and parses actual runtime ranges and
pnpm peer locators. Consumer engines, published engines, and selected managed
runtime are separate checks. The released adapter still requires managed Node
>=24.18.0 <25; its managed26 candidate is unselected and unqualified. Canary
admission retains the target identity gate and this genuine denial.

`--mode package-compatibility` installs the published stable31 package fixture
in separate disposable state, checks exact SRIs, roots, edges and locked peers,
executes released SDK behavior, verifies the adapter's precise managed26 denial
against the original Git checkout, and runs the released portable Docs check on
the digested copy. The workflow always schedules this job. Its result is public
package compatibility, not managed qualification or stable31 consumer adoption.
Every command must succeed; a skipped job proves no compatibility.

Before SDK execution, the runner copies `scripts/node26-public-package-probe.mts`
and `scripts/node26-public-packages/tsconfig.json` into the independently installed
fixture. Its pinned TypeScript7.0.2 runs strict `--noEmit` against the installed
Foundation1.7.2 and adapter0.3.2 declarations, with `@types/node`26.6.4 for the
Node26 API target. Node26 then strips erasable syntax to execute `probe.mts`;
type stripping does not replace typechecking. The retained Main-generated fixture
lock includes the exact compiler and Node types.

The separate fixture stores inert data in `scripts/node26-public-packages/pnpm-workspace.yaml.in`.
pnpm reads this policy only after an explicit copy to `pnpm-workspace.yaml`
in a separate external install root; Source has no nested workspace.
Its only setting, `minimumReleaseAgeExclude`, names exact Foundation1.7.2 and
adapter0.3.2, the two already qualified versions refused by gate1277. It leaves
pnpm11's default age guard for every other coordinate. The runner and all three
CI parser fixtures copy this policy alongside the manifest and frozen lock.
Before SDK execution, the pinned YAML parser rejects extra settings, duplicates,
ranges, wildcards or other exceptions against the five validated public tuples.

Retained central2b records stable20 for Canary. Main's supplied current central60de
records Canary20 and Token pending31. Keep selected profile, state and caller bytes until the owning upgrade
generates real postimages. The root public package lock is current; it is not a
generated managed-cohort selection.
Final candidate assembly requires those generated target31 postimages; current
managed qualification is not inferred from publication or this fixture.

Main generated and reviewed the retained fixture lock on Node24.18.0. Any
necessary future resolution must copy the fixture policy into its external root. The exact parser pins were verified by Main on 2026-10-03:
semver7.8.5 (Node>=10) and yaml2.9.1 (Node>=14.6); their supplied SRIs are in the
runner contract. The published five-package pins are separate from selection.

```sh
resolution_root=$(mktemp -d "$taskScratch/resolution.XXXXXX")
cp scripts/node26-public-packages/manifest.json "$resolution_root/package.json"
cp scripts/node26-public-packages/pnpm-workspace.yaml.in "$resolution_root/pnpm-workspace.yaml"
"$selectedNode" "$COREPACK_JS" pnpm --dir "$resolution_root" --version # must be 11.18.0
"$selectedNode" "$COREPACK_JS" pnpm --dir "$resolution_root" install --lockfile-only --ignore-scripts --ignore-pnpmfile --engine-strict --strict-peer-dependencies --store-dir "$resolution_root/store" --config.manage-package-manager-versions=false
# Review exact direct pins, five package/parser/compiler/Node type SRIs, and peer contexts.
cp "$resolution_root/pnpm-lock.yaml" scripts/node26-public-packages/locked-dependencies.yaml
```

Main retains the actual reviewed resolver output; this policy correction preserves
that lock byte for byte and requires a fresh real Node26 fixture gate. The runner copies `locked-dependencies.yaml` as `pnpm-lock.yaml` outside the
consumer; this avoids a nested managed-consumer lock. A missing lock is an error.
Policy tests require `NODE26_POLICY_TOOLS` pointing to an independently installed
copy of that fixture. Installs disable scripts and use strict engines and peers;
the runner also executes `pnpm peers check --lockfile-only` and preserves the
existing `docs:protocol:check` gate in production, node24-compatibility, and canary modes.

The existing disposable locked-peer regression remains in
`test/fixtures/node26-locked-peers.mjs`; it exercises real pnpm acceptance and
rejection with local tarballs and an isolated store on Node26.11.1.
