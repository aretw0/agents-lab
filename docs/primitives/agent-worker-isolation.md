---
title: Agent Worker Isolation
description: Runtime-agnostic isolation contract for bounded agent-worker execution.
---

# Agent Worker Isolation

`agent-worker-isolation` defines the isolation contract for a bounded worker run. It is a sibling of `agent-worker-envelope`: the envelope says what a worker run is, while this primitive says which boundaries must be verified before that run is allowed to start.

The contract is runtime-agnostic. Pi, local process runners, provider adapters, containers and future worktree runners may implement it differently, but they must report the same isolation claims and blockers.

## Status

Default 0.8 isolation level: **logical workspace isolation**.

That means the control plane can prove:

- the requested `cwd` matches the parent workspace;
- the run declares the files it may inspect;
- environment exposure is explicit and allowlisted;
- logs and registry records are parent-controlled;
- the parent can follow the process and build an outcome.

It does **not** mean the worker is in a strong sandbox. Stronger filesystem, process, network, CPU, memory or credential isolation requires a separate level and evidence.

## Isolation Levels

| Level | Meaning | Promotion requirement |
| --- | --- | --- |
| `logical` | Parent validates spec boundaries before spawn, but the process shares the host workspace. | Current default for 0.8 single-worker runs. |
| `workspace` | Process is constrained to a known workspace root by runner policy and path checks. | Requires explicit path validation and tests. |
| `worktree` | Process runs in an isolated worktree or throwaway checkout. | Requires lifecycle, cleanup and touched-files evidence. |
| `container` | Process runs in a container or equivalent process/filesystem boundary. | Requires image, mount, network and artifact policy evidence. |
| `unknown` | Isolation cannot be classified from evidence. | Must not be promoted as safe execution. |

Adapters may report a lower level than requested. They must not report a higher level without evidence.

## Required Checks

Every executable worker envelope should be checked before process start:

| Boundary | Required rule |
| --- | --- |
| `cwd` | Requested run cwd must resolve to the parent-approved workspace root. |
| `declaredFiles` | Each declared file must be relative to the workspace, non-empty and within the workspace after path resolution. |
| `envKeys` | Only explicitly allowed environment keys may be passed to the worker. Values must not imply broad credential or host exposure. |
| `logPath` | Log path must resolve inside a parent-controlled reports directory for the workspace. |
| `registry` | Registry path and run entry must be controlled by the parent and written before spawn. |
| `executionPreview` | Command and args must be typed data, not shell interpolation. |
| `fileContract` | Read-only and mutation contracts must be validated separately from process exit. |

When a check cannot be performed, the isolation claim is `unknown` and execution should block unless a higher-level operator decision explicitly accepts that risk for a one-off run.

## Blockers

Use stable blockers so adapters can report comparable failures:

- `execute-cwd-mismatch`
- `declared-file-outside-workspace`
- `declared-file-missing`
- `env-key-not-allowed`
- `log-path-outside-workspace`
- `registry-path-outside-workspace`
- `execution-preview-shell-interpolation`
- `isolation-level-unknown`

Adapters may add more specific blockers, but these should remain the portable baseline.

## Adapter Boundary

The core contract should remain separate from adapter mechanics:

- Core decides which isolation claims and blockers exist.
- Adapters translate their local run spec into the core check input.
- Adapters may add enforcement, but cannot redefine a failed core check as pass.
- Tests for adapters should assert both the portable blocker and the adapter-specific no-spawn behavior.

For example, a Pi adapter may provide `PI_CODING_AGENT_DIR`, while a container adapter may provide image and mount metadata. Both still need to report `cwd`, `declaredFiles`, `envKeys`, `logPath`, registry and shell/interpolation evidence.

## Not Promoted

This primitive does not promote:

- network isolation;
- credential isolation;
- CPU or memory quotas;
- filesystem sandboxing outside the declared workspace checks;
- automatic worktree/container lifecycle;
- protected scope execution;
- unattended fanout or swarm execution.

Those are stronger envelopes and need dedicated canaries.

## External Sandbox Comparison

The approved external influence pass included `mattpocock/sandcastle` as a
comparison source for sandbox vocabulary. Parent-side fan-in classified this
source as `post-0.8-or-protected-follow-up` in
`.project/reports/external-influence-fanin-0-8.json`.

Applicable comparison vocabulary:

- isolate worker intent from host execution side effects;
- make filesystem, process and network claims explicit;
- require local tests before promoting a stronger isolation level.

Current 0.8 claim remains narrower: `logical` workspace isolation. The project
can currently prove path, cwd, declared-file, log and registry checks before
dispatch. It does not yet claim strong sandboxing for process, network,
credentials, CPU, memory or filesystem mutation outside those checks.

Promotion rule: external sandbox patterns may seed post-0.8 hardening tasks,
but they do not upgrade the isolation level until local canaries prove the
stronger boundary and parent-side outcome validation records the evidence.

## Reference Relationship

`agent_run_driver_step_dispatch` currently implements the `logical` level for local process execution:

- it defaults to preview;
- blocks missing structured approval for `execute=true`;
- blocks `execute-cwd-mismatch`;
- writes registry entries around a single process;
- records bounded log/follow/outcome evidence.

Future code should prefer a reusable isolation checker consumed by driver adapters rather than embedding architectural policy directly in one script.
