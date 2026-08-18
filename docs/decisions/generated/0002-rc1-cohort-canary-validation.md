---
id: ADR-0002
type: adr
status: proposed
owner: architecture/tooling
summary: Validates the qualified RC1 cohort through disposable end-to-end adoption.
---

# ADR-0002: RC1 cohort canary validation

## Context

The qualified `docs-2026-08-18-rc1` Cohort needs a disposable consumer proof before organization rollout.

## Decision

Adopt the exact Cohort, exercise deterministic consumer plan/apply, verify a second no-op apply, and run the complete daily authoring workflow in this test-only repository.

## Consequences

Successful hosted CI can be bound to this exact commit as canary evidence. Production consumers remain unchanged until that evidence exists.
