# Canary agents

This repository is test-only and contains no production runtime.

Owner direction (2026-10-11): Node26.11.1 is the active default. Retain
Node24.18.0 compatibility checks and all historical receipts and accepted ADRs.
Use the explicit Node/Corepack recipe in README.md; Node26 does not bundle
Corepack. Strict engine and managed-cohort admission gates remain required;
report incompatible pinned dependencies without changing their contracts.

<!-- agent-teams-docs:route/v1 begin -->
Use [.agents/skills/docs-authoring/SKILL.md](.agents/skills/docs-authoring/SKILL.md) for documentation.
<!-- agent-teams-docs:route/v1 end -->

<!-- agent-teams:quality-standard:start -->
Before planning, implementing, or reviewing changes, read and follow the
[organization Engineering Quality Standard](https://github.com/agent-teams-ai/.github/blob/main/docs/engineering-quality-standard.md).
Apply it with this repository's instructions, accepted decisions and local
adoption profiles. This reference does not change pinned architecture contracts
or certify existing code as conformant.
<!-- agent-teams:quality-standard:end -->
