# TASK-BUD-1066 runner-timeout diagnostic packet (2026-05)

## Scope

Read-only diagnostic packet for `TASK-BUD-1066`. This packet does **not** authorize subprocess retry, SDK worker dispatch, provider/model calls, protected-scope changes, settings changes, CI changes, or remote work.

## Current classification

- Primary subprocess canary: `task-bud-1066-subprocess-preflight-canary`
- Registry state: `timed-out`
- Failure classification: `runner-timeout`
- Preflight: `needs-evidence`
- Retry allowed: `no`
- Startup diagnostic decision: `structured-probe-first`
- Canary allowed: `no`
- Dispatch: `no`
- Authorization: `none`

## Evidence from existing logs

`task-bud-1066-subprocess-preflight-canary.log` records:

- command: current Node entrypoint
- cwd exists: yes
- command exists: yes
- pi CLI entrypoint exists: yes
- platform/node captured: `win32`, `v24.6.0`
- timeout: `timeout ms=60000; sending SIGTERM`
- timeout class: `runner-timeout`
- close: `exitCode=124`, `signal=SIGTERM`, `timedOut=yes`
- output: `childOutputBytes=0`, `stdoutBytes=0`, `stderrBytes=0`

Older diagnostic canary evidence (`task-bud-1066-readonly-runner-diagnostic-canary.log`) still shows the legacy silent non-zero shape: exit code 1 with no stdout/stderr and no structured preflight lines. The current actionable path is therefore the newer preflight timeout evidence, not a blind retry of the legacy shape.

## Worker probe results

### argv-shape inspection

Exact-approved SDK in-process worker `task-bud-1066-sdk-argv-shape-inspection` completed read-only with no touched files.

Result:

- `PASS; cli-argv-valid`
- Required flags were present: `--no-session`, `--model`, `--tools`, `--print`.
- Attachments and inline prompt were present.
- Static diagnostics found no argv blockers.
- Recommended next probe: `timeout-budget-probe`.

### timeout-budget probe

Exact-approved SDK in-process worker `task-bud-1066-sdk-timeout-budget-probe` completed read-only with no touched files.

Result:

- `FAIL; timeout-budget`
- Present evidence: `timeoutMs=60000`, `signal=SIGTERM`, `timedOut=yes`.
- Missing evidence in the actual canary log: `elapsedMs`.
- Parser/startup diagnostics expect `elapsedMs` for timeout-budget analysis.
- Recommended next probe remains `timeout-budget-probe`, narrowed to capture-path/timing instrumentation evidence before any retry-like canary action.

### capture-path check

Exact-approved SDK in-process worker `task-bud-1066-sdk-capture-path-check` completed read-only with no touched files.

Result:

- `PASS; capture-path`
- `elapsedMsFuture=yes`
- Parent-side status already computes `elapsedMs` from registry timestamps (`nowMs - startedAtIso`).
- Future subprocess runs can expose elapsed timing even if child stdout/stderr remains empty.
- Recommended next probe: report-only structured startup/provider probe, with `timeout-budget-probe` plus `startup-hang-probe` as the evidence branch.

### startup-boundary probe

Exact-approved SDK in-process worker `task-bud-1066-sdk-startup-boundary-probe` completed read-only with no touched files.

Result:

- `PASS; startup-boundary`
- Most likely zero-output boundary: `dist/modes/print-mode.js` `runPrintMode`, at `await session.prompt(initialMessage)` or subsequent `await session.prompt(message)`.
- This sits after argv validation and runtime/session setup, but before the `writeRawStdout` output path.
- Recommended next probe: distinguish `createAgentSessionRuntime(...)` completion from `session.prompt(...)` completion with report-only instrumentation/timestamp design before any subprocess retry.

### startup-timestamp design attempt

Exact-approved SDK in-process worker `task-bud-1066-sdk-startup-timestamp-design` failed safely with no touched files.

Result:

- `worker-contract-failed`
- Failure: `sdk-runner-loop-guard`
- Close: `state=failed reason=loop-guard outputBytes=0`
- Interpretation: the two-file timestamp-design prompt was too broad for the current narrow worker envelope.
- Next shape: shrink to one file and one named function, likely `dist/modes/print-mode.js` `runPrintMode`, before asking for a timestamp design.

### print-mode timestamp design

Exact-approved SDK in-process worker `task-bud-1066-sdk-printmode-timestamp-design` completed read-only with no touched files.

Result:

- `PASS; timestamp-design`
- Valid narrow shape: one file, one function focus (`print-mode.js` `runPrintMode`).
- Proposed probes: `prompt-start`, `prompt-end`, `stdout-first-byte`.
- Proposed implementation shape: local monotonic-timer probe table, wrap each `session.prompt(...)` with pre/post timestamps, and use a local `writeRawStdout` shim that records first invocation before delegating unchanged.

## Interpretation

The subprocess runner no longer looks like an immediate missing-file, missing-entrypoint, or static CLI argv-shape failure: cwd, Node command, CLI entrypoint, required print-mode flags, attachments, and prompt all exist. The current historical canary log lacks `elapsedMs`, but the current parent-side runtime is instrumented to expose elapsed timing for future subprocess runs. The remaining unknown is likely inside print-mode after runtime/session setup and before stdout emission, especially around `session.prompt(...)`. That makes `runner-timeout` the correct parent-side class and keeps blind retry blocked.

Most likely next diagnostic categories:

1. CLI argument parsing or print-mode startup before first visible output.
2. Provider/model bootstrap or auth path that blocks before stdout/stderr is emitted.
3. Tool allowlist/bootstrap behavior in subprocess print mode.
4. Stderr/stdout capture gap during early process initialization.
5. Windows-specific subprocess behavior that should be compared later with an isolated non-Windows probe, but only after report-only evidence is complete.

## Report-only next probe plan

All steps below are report-only and must keep `modelCallAllowed=false` and `dispatchAllowed=false` until a separate exact human confirmation authorizes a single canary.

1. **argv-shape inspection**
   - Compare generated argv with documented pi print-mode flags.
   - Validate `--no-session`, `--model`, `--tools`, attachment paths, and prompt placement without starting a model call.
   - Expected output: `cli-argv-valid` or `cli-argv-invalid:<reason>`.

2. **startup-surface inspection**
   - Inspect the local pi CLI print-mode startup path for first possible stdout/stderr emission and provider bootstrap boundary.
   - Expected output: named startup phase where zero-output hang can occur.

3. **provider bootstrap readiness**
   - Use read-only provider readiness/budget surfaces only.
   - Do not call the model.
   - Expected output: `provider-bootstrap-ready`, `provider-unavailable`, or `provider-needs-auth` evidence.

4. **tool allowlist compatibility check**
   - Validate subprocess `--tools read,grep,find,ls` against available CLI tool names and SDK declared-file policy lessons.
   - Expected output: `tool-allowlist-valid` or `tool-allowlist-invalid:<tool>`.

5. **capture-path check**
   - Inspect runner capture code for stdout/stderr handlers, timeout handler, elapsed time, signal, and close ordering.
   - Expected output: whether early stderr can be lost before close.

Only after those report-only probes produce a concrete reason should a future subprocess canary be proposed, and it must remain one exact-confirmed run with bounded timeout and no protected-scope changes.

## Non-goals

- No blind retry of `task-bud-1066-subprocess-preflight-canary`.
- No broad worker dispatch.
- No mutation worker.
- No provider/model call from this packet.
- No changes to settings, credentials, CI, publish, or remote state.

## Board impact

`TASK-BUD-1066` remains unresolved. `TASK-BUD-1068` may keep its dependency on `TASK-BUD-1066` until the subprocess runner-timeout cause is explained or the board explicitly splits SDK maturity from subprocess root cause.
