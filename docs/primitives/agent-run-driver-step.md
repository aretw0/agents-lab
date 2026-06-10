# Agent Run Driver Step

`agent_run_driver_step_dispatch` is the agnostic operational primitive for one bounded agent run. It exists to remove the operator as glue between preview, dispatch, follow and outcome materialization without promoting a colony, fan-in or next worker automatically.

## Contract

- Outputs include `schemaVersion=1` on the driver-step packet and on any embedded `agent-run-outcome-packet`.
- Preview is default: `execute=false` returns `dispatchAllowed=false` and `processStartAllowed=false`.
- Real execution requires structured operator approval and starts at most one subprocess.
- The run registry moves through `planned -> running -> terminal` with `runId`, `cwd`, `declaredFiles`, `providerModelRef`, `timeoutMs` and `logPath`.
- `follow=true` reads bounded terminal status and log evidence.
- `build_outcome=true` materializes an embedded `agent-run-outcome-packet` only when `follow=true` and the run is terminal.
- It never calls fan-in, starts a next worker or launches `ant_colony`.

## Surfaces

The stable surface is the Pi tool:

```text
agent_run_driver_step_dispatch
```

Repository scripts are wrappers of reference for local automation and external agents:

```bash
pnpm run agent-run:driver-step
pnpm run agent-run:pi-driver
pnpm run agent-run:pi-driver-payload
```

Those scripts are canonical for this repository workflow, but they are not the distributed package API by themselves. Portable consumers should target the primitive/tool contract and treat scripts as examples or local adapters.

## Promotion Rule

Use this primitive before hand-written subprocess glue when a task is local-safe, has declared files, has a bounded command preview and can be evaluated with an agent-run outcome packet.

Do not use it for protected scope, release publish, remote/offload promotion, multi-worker fan-in or unattended colony execution without a separate operator decision.
