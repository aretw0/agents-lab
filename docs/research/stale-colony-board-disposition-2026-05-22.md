---
title: Stale Colony Board Disposition
description: Release-readiness disposition for historical colony telemetry tasks.
---

# Stale colony board disposition — 2026-05-22

Status: reviewed, no colony work resumed.

## Context

The v0.8.0 readiness report had no open P0 tasks, but it still failed `board-release-clear` because five old colony telemetry tasks were `blocked`:

- `colony-c1`
- `colony-c2`
- `colony-c-123`
- `colony-c-ret-1`
- `colony-colony-a`

These tasks come from April/early May colony signals and repeated delivery-policy blocks. They do not represent an active runtime lane in the current workspace.

## Disposition

Close the five blocked telemetry tasks as historical board state.

This does not promote candidate files, does not resume a colony, and does not mark any stale candidate as delivered. Future colony work must start from a fresh task or a read-only promotion packet with explicit candidate evidence.

## Blocked task inventory

| Task | Disposition | Reason |
| --- | --- | --- |
| `colony-c1` | close as historical telemetry | Original candidate lacked validation log, file inventory, and selective promotion evidence; follow-up `colony-c1-promotion` was reviewed separately with no files promoted. |
| `colony-c2` | close as historical telemetry | Notes already record manual recovery from April; remaining blocked state is repeated missing validation-log telemetry. |
| `colony-c-123` | close as historical telemetry | Placeholder colony task with no workspace report, task summary, file inventory, or validation log. |
| `colony-c-ret-1` | close as historical telemetry | COMPLETE signal exists, but delivery evidence is incomplete and no candidate snapshot is available. |
| `colony-colony-a` | close as historical telemetry | Already classified as legacy noise with no active workspace lane. |

## Promoted file inventory

None.

## Skipped file inventory

- `colony-c1`: no verifiable candidate snapshot or complete delivery evidence.
- `colony-c2`: no current promotion scope; historical recovery already recorded.
- `colony-c-123`: placeholder telemetry only.
- `colony-c-ret-1`: terminal signal without delivery evidence.
- `colony-colony-a`: legacy noise without active work item.

## Validation command log

- `pnpm exec vitest run packages/pi-stack/test/smoke/colony-pilot-delivery-recovery.test.ts packages/pi-stack/test/smoke/colony-pilot-delivery.test.ts packages/pi-stack/test/smoke/colony-pilot-retention.test.ts packages/pi-stack/test/smoke/colony-pilot-artifacts-retention.test.ts packages/pi-stack/test/smoke/colony-pilot-status-retention.test.ts` — passed in the agents-lab devcontainer: 5 files, 34 tests.
- `pnpm run test:docs:site` — passed after adding the disposition packet.
- `pnpm run release:readiness:v0.8.0` — confirmed the remaining release blockers were the five stale colony tasks plus target version readiness.

## Future rule

A colony signal alone is not a release blocker and not delivery evidence. A future colony lane must provide:

- workspace report;
- task summary;
- file inventory;
- validation command log;
- promotion inventory when materializing to the target branch.
