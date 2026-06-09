# Serial driver packet validation (2026-06)

## Scope

Dogfood validation for `colony_serial_driver_packet` after `5317317e`.

No `ant_colony` was launched. No `agent_run` was executed. No files, `decision.md`, or `.project/tasks.json` were edited during the validation run.

## Execution 1

Input shape:

- `planId`: `serial-subagent-bootstrap-001`
- `completedOutcomes`: `[]`

Observed result:

- `mode`: `colony-serial-driver-packet`
- `decision`: `next-worker-ready`
- `nextWorkerPacketId`: `worker-01-route-scan`
- `requiredApprovalPrompt`: `approve worker colony-serial-subagent-bootstrap-001-worker-01-route-scan`
- `driverSteps` includes:
  - `colony_worker_start_packet`
  - `agent_run_outcome_packet`
  - `colony_serial_fanin_packet`
- `dispatchAllowed`: `false`
- `processStartAllowed`: `false`
- `batchExecutionAllowed`: `false`

## Execution 2

Input shape:

- `planId`: `serial-subagent-bootstrap-001`
- `completedOutcomes`: `["outcome:serial-subagent-bootstrap-001:worker-01-route-scan"]`

Observed result:

- `mode`: `colony-serial-driver-packet`
- `decision`: `next-worker-ready`
- `nextWorkerPacketId`: `worker-02-surface-scan`
- `requiredApprovalPrompt`: populated
- `dispatchAllowed`: `false`
- `processStartAllowed`: `false`
- `batchExecutionAllowed`: `false`

## Assessment

The report-only driver correctly selects the next pending worker from `executionManifest` and advances when a completed outcome is supplied. It preserves the lane boundary by refusing dispatch/process start and by pointing the caller to existing serial steps rather than launching execution.

## Next slice

Implement `colony_serial_driver_dispatch` as preview-only first:

- consume the driver packet or equivalent `executionManifest`;
- prepare exactly one `colony_worker_start_packet`/agent invocation handoff;
- default to `dispatchAllowed=false`;
- require structured operator approval before any future `execute=true` path;
- keep `ant_colony` blocked.
