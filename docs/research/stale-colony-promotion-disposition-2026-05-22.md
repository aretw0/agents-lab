---
title: Stale Colony Promotion Disposition
description: Read-only disposition for historical colony promotion tasks.
---

# Stale colony promotion disposition — 2026-05-22

Status: reviewed, no promotion applied.

## Scope

This packet covers the remaining historical promotion tasks:

- `colony-c2-promotion`
- `colony-c-123-promotion`
- `colony-c-ret-1-promotion`

The source colony telemetry tasks were already closed as stale release-readiness noise in `stale-colony-board-disposition-2026-05-22.md`. These promotion tasks are the corresponding planned follow-ups that still remained open.

## Decision

Close the three promotion tasks as stale promotion records.

No candidate files are promoted. No old colony worktree is resumed. No historical COMPLETE signal is treated as delivery evidence.

## Promoted file inventory

None.

## Skipped file inventory

| Task | Candidate state | Reason |
| --- | --- | --- |
| `colony-c2-promotion` | historical recovery already recorded | Notes point to April manual recovery and legacy partial verification; there is no current candidate scope to promote. |
| `colony-c-123-promotion` | placeholder telemetry only | Source task lacked workspace report, task summary, file inventory, and validation log. |
| `colony-c-ret-1-promotion` | terminal signal without delivery evidence | Source task had COMPLETE-like telemetry, but no complete delivery packet or rollback plan. |

## Validation command log

- `pnpm run ci:local:parity` — passed in the agents-lab devcontainer at `6b2829cb`.
- `pnpm run release:readiness:v0.8.0` — wrote a report with `board-release-clear` green and `releaseBlockers: none`; decision remains `not-ready` only because packages are still `0.7.0`.

## Future rule

Promotion work must start from a fresh read-only packet with:

- candidate id and workspace location;
- declared file inventory;
- validation command log;
- rollback plan;
- explicit promoted/skipped file inventory.

If any of those are missing, the correct outcome is a skip/disposition packet, not branch mutation.
