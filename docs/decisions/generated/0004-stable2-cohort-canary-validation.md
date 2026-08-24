---
id: ADR-0004
type: adr
status: proposed
owner: architecture/tooling
summary: Validates the stable2 cohort migration and destructive lifecycle in the disposable Docs Protocol canary.
related:
  - ADR-0003
---

# ADR-0004: Stable2 cohort canary validation

## Context

The qualified `docs-2026-08-24-stable2` cohort is the fix-forward stable target
for this disposable canary's current `docs-2026-08-18-rc2` binding.

## Decision

Adopt the exact Foundation `0.18.0` and Docs Protocol `0.1.2` pair with the
qualified record, event, runtime closure, and controller workflow identities.
Validate the governed digest-bound migration, stale-plan rejection, no-op
stability, crash recovery, and daily authoring lifecycle before committing.

## Consequences

The canary returns to canonical registry mode with stable2 managed projections
and can provide immutable rollout evidence. No rollback is declared because the
qualified stable2 transition is fix-forward and publishes no rollback target.
