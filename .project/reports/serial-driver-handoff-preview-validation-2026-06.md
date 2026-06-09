# Serial driver handoff preview validation (2026-06)

## Scope

Dogfood validation for `colony_serial_driver_dispatch` handoff output after `606bc697`.

No `ant_colony` was launched. No `agent_run` was executed. No files were edited during the validation run.

## Preview run

Input shape:

- `executionManifest`: 2 workers
  - `worker-01-route-scan`
  - `worker-02-surface-scan`
- `completedOutcomes`: `[]`
- `execute`: omitted/false

Observed result:

- `mode`: `colony-serial-driver-dispatch-packet`
- `decision`: `ready-for-operator-decision`
- `nextWorkerHandoff`: present
- `nextWorkerHandoff.handoffId`: `handoff:serial-subagent-bootstrap-001:worker-01-route-scan`
- `nextWorkerHandoff.requiredOutcomeId`: `outcome:serial-subagent-bootstrap-001:worker-01-route-scan`
- `nextWorkerHandoff.expectedArtifact`: `.project/reports/serial-subagent-bootstrap-001-worker-01-route-scan.json`
- `nextWorkerHandoff.requiredArtifact`: same as `expectedArtifact`
- `nextWorkerHandoff.requiredApprovalPrompt`: `approve worker colony-serial-subagent-bootstrap-001-worker-01-route-scan`
- `nextWorkerHandoff.logPath`: `.pi/reports/colony-serial-subagent-bootstrap-001-worker-01-route-scan.log`
- `nextWorkerHandoff.logPath` matched `nextWorkerStartPacket.agentInvocationSpecPacket.invocationSpec.logPath`
- `nextWorkerHandoff.registryRequiredFields.state`: `planned`
- `dispatchAllowed`: `false`
- `processStartAllowed`: `false`

## Execute guard

Input shape:

- same manifest
- `execute`: `true`
- no structured `operator_approval`

Observed result:

- `decision`: `blocked`
- `blockers`: `["structured-operator-approval-missing"]`
- `nextWorkerHandoff`: absent/undefined
- `dispatchAllowed`: `false`
- `processStartAllowed`: `false`

## Assessment

The dispatch preview now exposes a stable parent-side handoff object for the next worker, including the approval prompt, expected artifact, log path, and registry fields required before a future execution slice. The blocked `execute=true` path correctly suppresses handoff emission when structured approval is missing.

## Next slice

Design the first execution slice for exactly one worker:

- consume `nextWorkerHandoff`;
- require structured operator approval;
- write registry state `planned -> running`;
- start one Pi subprocess;
- capture bounded log output;
- leave outcome/fan-in as a separate parent-side follow-up step.
