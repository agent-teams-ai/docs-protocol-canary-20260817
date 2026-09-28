# Docs Protocol Canary

Disposable organization-owned repository for Managed Docs Protocol qualification.
It contains no production runtime, customer data, or provider integration.

## Node runtime qualification

`scripts/node26-canary-qualification.mjs` creates an exclusive work root, copies
the candidate without Git metadata or installed dependencies, and records a
digest of the copied bytes before a strict frozen install. It retains result or
failure evidence in `work-root/evidence` and removes only its own temporary
consumer and package-manager state. An occupied or symlinked work root is
rejected without changing its contents.

Production mode validates the retained Node 24 Foundation artifact against the
manifest, lockfile, and managed state. Canary mode separately requires the
published Node 26 Foundation artifact identity. The contract currently records
that publication as pending, so a blocked Node 26 result is not qualification.
Use exact Node 24.18.0 or Node 26.10.0 for the respective modes and a new,
empty work-root path for each invocation. Successful qualification also requires
the fresh strict install and `docs:protocol:check` gate to pass.
