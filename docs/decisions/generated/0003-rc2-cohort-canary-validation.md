---
id: ADR-0003
type: adr
status: proposed
owner: architecture/tooling
summary: Validates the qualified RC2 cohort through disposable end-to-end adoption.
---

# ADR-0003: RC2 cohort canary validation

## Context

The qualified `docs-2026-08-18-rc2` Cohort needs a disposable proof before the
organization consumers move from RC1.

## Decision

Adopt the exact RC2 package pair and workflow authority through the normal
digest-bound consumer plan/apply path. Exercise stale-plan rejection, a second
no-op apply with unchanged `mtime`, and the complete daily authoring workflow.

## Consequences

Successful hosted pull-request and default-branch checks can be bound as the
immutable canary evidence for organization rollout. Production consumers remain
on RC1 until that evidence is recorded centrally.
