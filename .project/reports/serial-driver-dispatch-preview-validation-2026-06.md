# Serial driver dispatch preview validation (2026-06)

## Scope

Dogfood validation for `colony_serial_driver_dispatch` after `56a9ddb9`.

No `ant_colony` was launched. No `agent_run` was executed. No files, `decision.md`, or `.project/tasks.json` were edited during the validation run.

## Preview run

Input shape:

- `executionManifest`: 2 workers
- `completedOutcomes`: `[]`
- `execute`: omitted

Observed result:

- `mode`: `colony-serial-driver-dispatch-packet`
- `decision`: `ready-for-operator-decision`
- `nextWorkerPacketId`: `worker-01-route-scan`
- `nextWorkerStartPacket.mode`: `colony-worker-start-packet`
- `nextWorkerStartPacket.dispatchAllowed`: `false`
- `driverSteps` includes:
  - `colony_worker_start_packet`
  - `agent_run_outcome_packet`
  - `colony_serial_fanin_packet`
- `dispatchAllowed`: `false`
- `processStartAllowed`: `false`
- `batchExecutionAllowed`: `false`
- `executeRequested`: `false`

## Future execute guard

Input shape:

- same manifest
- `execute`: `true`
- no structured `operator_approval`

Observed result:

- `mode`: `colony-serial-driver-dispatch-packet`
- `decision`: `blocked`
- `blockers`: `["structured-operator-approval-missing"]`
- `dispatchAllowed`: `false`
- `processStartAllowed`: `false`
- `executeRequested`: `true`

## Assessment

The preview-only dispatch wrapper prepares the next one-worker handoff without starting execution. The future `execute=true` path is already guarded by structured approval and remains non-dispatching in this slice.

## Next slice

Add parent-side evidence capture for the preview handoff:

- save or expose the exact `nextWorkerStartPacket` as the handoff object;
- define the registry/log fields required before a future execute path;
- keep dispatch disabled until a separate execution slice adds one-worker process start.
