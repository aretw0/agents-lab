---
title: 0.8 Complexity Debt Register - 2026-06-18
description: Explicit register for known line-budget exceptions before the 0.8.0 release.
---

# 0.8 Complexity Debt Register - 2026-06-18

Status: active debt register
Target: 0.8.0
Decision: track-and-reduce

This register explains every source file allowed by repo complexity audit as `allowed:complexity-debt`. It is not a release approval. The purpose is to keep the strict gate useful while making each exception visible and actionable.

The line budget remains 1000 lines. New files above that budget should be split instead of added here unless there is a short operator-visible reason and a concrete reduction plan.

## Current Exceptions

| Path | Reason to tolerate temporarily | Next reduction slice |
|------|--------------------------------|----------------------|
| `packages/pi-stack/extensions/colony-pilot.ts` | Broad legacy facade still owns multiple colony pilot concerns and exported compatibility surface. | Split command registration, runtime orchestration, and retention/advisory surfaces behind smaller modules. |
| `scripts/release-readiness-report.mjs` | Canonical release gate aggregates version, board, workflow, package, content, dogfood and evidence state. | Extract gate builders and markdown rendering into focused modules while preserving JSON schema. |
| `packages/pi-stack/extensions/guardrails-core-agent-run-start.ts` | Agent-run start packet family centralizes a large protected execution contract. | Split shared validation, packet builders, and surface registration. |
| `packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts` | Parser regression coverage is dense and protects many colony compatibility cases. | Move repeated fixtures/builders to a local fixture module. |
| `scripts/pi-dev-pressure.mjs` | Development pressure report aggregates session, entrypoint, settings, board and runtime pressure. | Extract collectors by signal family and keep CLI/report assembly thin. |
| `packages/pi-stack/test/smoke/project-board-tools.test.ts` | High-value board tool regression suite has many scenario fixtures inline. | Extract repeated fake Pi/tool setup and split read-only vs mutation scenarios. |
| `packages/pi-stack/extensions/environment-doctor.ts` | Environment doctor remains a broad diagnostic entrypoint with compatibility-facing output. | Split runtime profile, dependency checks, and report formatting. |
| `docs/guides/control-plane-operating-doctrine.md` | Long doctrine guide is published and already synchronized into packages. | Split into shorter doctrine, operating loop, and release/guardrail pages. |
| `packages/lab-skills/docs/guides/control-plane-operating-doctrine.md` | Packaged copy follows the canonical guide until the source is split. | Regenerate after source guide split. |
| `packages/pi-skills/docs/guides/control-plane-operating-doctrine.md` | Packaged copy follows the canonical guide until the source is split. | Regenerate after source guide split. |

## Recent Reduction

During this hardening pass, `scripts/test/release-readiness-report.test.mjs` was removed from complexity debt by extracting a shared fixture and moving evidence-heavy tests to `scripts/test/release-readiness-report-evidence.test.mjs`. Both test files now stay below the 1000-line budget.

## Gate Contract

- `repo:complexity:strict` may pass with these entries, but it must print them as `allowed:complexity-debt`.
- Every `allowed:complexity-debt` path must appear in this register.
- A new exception without a documented next reduction slice is a blocker for release hardening, even if the technical gate can be made green.
