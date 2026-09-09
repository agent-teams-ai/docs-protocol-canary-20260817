# Docs Protocol Canary

Disposable organization-owned repository for Managed Docs Protocol qualification.
It contains no production runtime, customer data, or provider integration.

The consumer explicitly adopts Foundation `documentation.local-references` v1
through `foundation.config.yaml`. Its full check covers `docs/decisions`: the
index, five canonical ADRs (including `generated/`), and their five index links.
New decisions under that root enter link checking automatically. The consumer
regression gate pins the current six-document baseline and must be deliberately
updated when that catalog grows. It also rejects disabled or narrowed policy,
including an otherwise passing empty-directory check.

Run `pnpm check` for dependency placement, registry provenance, the full configured
Foundation capability, focused capability regressions, and the existing portable
Docs/migration gate. `pnpm test:foundation-gates` invokes the installed public CLI
against disposable fixtures; it tests broken links, missing anchors, repository
escapes, added decisions and root configuration controls. No production source
architecture is claimed. Templates, root README/AGENTS, test JavaScript, external
URL availability and managed evidence are outside Local References.

This Canary does not activate Source Dependencies or invent a production boundary.
Its three exact development dependency roots and historical managed records remain
intact. Foundation package assertions, Foundation capabilities, portable Docs and
trusted managed qualification are separate gates.

`CI` / `check` runs the full gate on pull requests, merge groups and main pushes.
The existing Documentation Protocol workflow retains its separate managed route.
The coordinator must qualify the exact consumer installation/locks, bind trusted
managed evidence to the candidate, and verify both required hosted statuses and
protection reject missing/skipped/failed execution. Workflow files alone do not
prove those protections. A borrowed installation can run focused tests;
its registry-provenance refusal must remain a failure, never full-check success.
