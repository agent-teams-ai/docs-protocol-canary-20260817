---
id: ADR-0005
type: adr
status: proposed
owner: architecture/tooling
summary: Validates the stable3 cohort migration and recovery lifecycle in the disposable Docs Protocol canary.
related:
  - ADR-0004
---

# ADR-0005: Stable3 cohort canary validation

## Context

The qualified `docs-2026-08-25-stable3` cohort is the fix-forward successor to
this disposable canary's current `docs-2026-08-24-stable2` binding.

## Decision

Adopt the exact Foundation `0.19.0` and Docs Protocol `0.1.4` pair with the
qualified record, event, runtime closure, and controller workflow identities.
Validate the digest-bound migration, stale-plan protection, no-op stability,
crash recovery, and daily authoring lifecycle before recording canary evidence.

## Consequences

The canary provides immutable stable3 rollout evidence while all product
consumers remain on stable2. No rollback target is declared, so any defect must
use the qualified fix-forward or suspension path.
