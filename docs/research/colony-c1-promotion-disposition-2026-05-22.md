---
title: Colony c1 Promotion Disposition
description: Read-only disposition packet for the stale colony-c1 promotion task.
---

# Colony c1 promotion disposition — 2026-05-22

Status: reviewed, no promotion applied.

## Workspace report

- Candidate: `c1|colony-mnzmi243-lk2d0`
- Board task: `colony-c1-promotion`
- Source task: `colony-c1`
- Review mode: read-only
- Mutation allowed: false
- Promotion allowed: false
- Decision: skip stale promotion, keep future promotion work behind a fresh packet.

## Task summary

`colony-c1-promotion` was auto-queued from April 2026 colony telemetry because the original run did not leave the required delivery evidence: workspace report, task summary, file inventory, validation command log, and selective promotion inventory.

Current repository state no longer has a verifiable candidate worktree or bounded file list for `c1|colony-mnzmi243-lk2d0`. Treating the old telemetry as promotable code would violate the colony delivery policy and the read-only promotion packet primitive.

## Promoted file inventory

None.

No file from the stale candidate was promoted to the target branch in this review.

## Skipped file inventory

- `c1|colony-mnzmi243-lk2d0`: skipped because there is no verifiable candidate snapshot, declared file list, diff/apply evidence, or rollback plan available in the current workspace.

## Validation command log

- `pnpm exec vitest run packages/pi-stack/test/smoke/colony-pilot-delivery-recovery.test.ts packages/pi-stack/test/smoke/colony-pilot-delivery.test.ts packages/pi-stack/test/smoke/colony-pilot-retention.test.ts packages/pi-stack/test/smoke/colony-pilot-artifacts-retention.test.ts packages/pi-stack/test/smoke/colony-pilot-status-retention.test.ts` — passed in the agents-lab devcontainer: 5 files, 34 tests.
- `pnpm run ci:local:parity` — passed at the current release-readiness baseline before this disposition packet.
- `pnpm run release:readiness:v0.8.0` — at the time of this packet, reported no open P0 tasks and identified stale colony board items plus target version readiness as the remaining blockers.
- Current readiness reports after the stale colony dispositions show `board-release-clear` green and `releaseBlockers: none`; release remains intentionally not-ready until a version bump/release decision.

## Rollback

No code or candidate files were promoted. Rollback is limited to reverting this disposition document and the board verification that references it.

## Operator review

This packet resolves the stale promotion as an explicit skip, not as a materialized delivery. A future attempt to use colony output must start from a fresh candidate with:

- declared files;
- validation gate;
- rollback plan;
- `Promoted file inventory`;
- `Skipped file inventory`;
- `Validation command log`.
