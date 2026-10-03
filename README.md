# Docs Protocol Canary

Disposable organization-owned repository for Managed Docs Protocol qualification.
It contains no production runtime, customer data, or provider integration.

## Node runtime runner

The runner copies a clean candidate without Git metadata or dependencies, binds
its preinstall bytes to a candidate digest, and uses an exclusive external work
root with isolated package-manager state. It preserves evidence and removes
only directories it still owns. Use Node24.18.0 / pnpm11.18.0 for `production`
and exact Node26.10.0 for `canary` or `package-compatibility`; Node25 stays skipped.

Production admission retains stable20 and can accept generated stable31 later.
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

The separate fixture uses `scripts/node26-public-packages/pnpm-workspace.yaml`.
Its only setting, `minimumReleaseAgeExclude`, names exact Foundation1.7.2 and
adapter0.3.2, the two already qualified versions refused by gate1277. It leaves
pnpm11's default age guard for every other coordinate. The runner and all three
CI parser fixtures copy this policy alongside the manifest and frozen lock.
Before SDK execution, the pinned YAML parser rejects extra settings, duplicates,
ranges, wildcards or other exceptions against the five validated public tuples.

Retained central2b records stable20 for Canary. Main's supplied current central60de
records Canary20 and Token pending31. Keep all selected profile, state, caller and root lock
bytes until an authorized public generation-2 upgrade generates real postimages.
Final candidate assembly requires those generated target31 postimages; current
managed qualification is not inferred from publication or this fixture.

Main generated and reviewed the retained fixture lock on Node24.18.0. Any
necessary future resolution must copy the fixture policy into its external root. The exact parser pins were verified by Main on 2026-10-03:
semver7.8.5 (Node>=10) and yaml2.9.1 (Node>=14.6); their supplied SRIs are in the
runner contract. The published five-package pins are separate from selection.

```sh
resolution_root=$(mktemp -d)
cp scripts/node26-public-packages/manifest.json "$resolution_root/package.json"
cp scripts/node26-public-packages/pnpm-workspace.yaml "$resolution_root/pnpm-workspace.yaml"
corepack pnpm --dir "$resolution_root" --version # must be 11.18.0
corepack pnpm --dir "$resolution_root" install --lockfile-only --ignore-scripts --ignore-pnpmfile --engine-strict --strict-peer-dependencies --store-dir "$resolution_root/store" --config.manage-package-manager-versions=false
# Review exact direct pins, five package/parser/compiler/Node type SRIs, and peer contexts.
cp "$resolution_root/pnpm-lock.yaml" scripts/node26-public-packages/locked-dependencies.yaml
```

Main retains the actual reviewed resolver output; this policy correction preserves
that lock byte for byte and requires a fresh real Node26 fixture gate. The runner copies `locked-dependencies.yaml` as `pnpm-lock.yaml` outside the
consumer; this avoids a nested managed-consumer lock. A missing lock is an error.
Policy tests require `NODE26_POLICY_TOOLS` pointing to an independently installed
copy of that fixture. Installs disable scripts and use strict engines and peers;
the runner also executes `pnpm peers check --lockfile-only` and preserves the
existing `docs:protocol:check` gate in production/canary modes.

The existing disposable locked-peer regression remains in
`test/fixtures/node26-locked-peers.mjs`; it exercises real pnpm acceptance and
rejection with local tarballs and an isolated store on Node26.10.0.
