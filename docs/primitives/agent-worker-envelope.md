---
title: Agent Worker Envelope
description: Runtime-agnostic single-worker contract for bounded agent execution.
---

# Agent Worker Envelope

`agent-worker-envelope` is the distributable contract for one bounded worker run. It is intentionally runtime-agnostic: the contract can be implemented by Pi, a provider-specific adapter, a local script runner, or another future execution surface without requiring colony or `ant_colony` semantics.

## Status

Default 0.8 worker envelope: **single worker, parent-side authority, explicit evidence**.

This primitive promotes the smallest agent-first execution unit that is currently mature:

1. declared scope;
2. explicit operator approval before process start;
3. one bounded process;
4. registry and log evidence;
5. follow/status;
6. parent-side outcome;
7. touched-files validation.

## Envelope Fields

The portable envelope should include these fields, regardless of adapter:

| Field | Purpose |
| --- | --- |
| `runId` | Stable id for registry, logs, follow and outcome. |
| `providerModelRef` | Provider/model identity or local runner identity used for the worker. |
| `cwd` | Workspace root for the run. |
| `declaredFiles` | Files the worker is allowed to read or reason over. |
| `fileContract` | `read-only` or a stricter mutation contract. |
| `toolAllowlist` | Tools available to the worker. |
| `timeoutMs` | Bounded runtime. |
| `logPath` | Durable log path controlled by the parent. |
| `executionPreview` | Command/args or equivalent typed invocation preview. |
| `operatorApproval` | Structured approval required before execution. |
| `registryRequiredFields` | Minimum planned entry: `runId`, `cwd`, `declaredFiles`, `providerModelRef`, `timeoutMs`, `logPath`, `state`. |
| `outcomeContract` | Expected process state, file contract, artifact markers and touched-files policy. |

## Required Lifecycle

1. **Preview:** build the envelope and show the command/spec with `dispatchAllowed=false` and `processStartAllowed=false`.
2. **Approval:** require structured operator approval for real execution.
3. **Registry planned:** write a `planned` registry entry before spawning.
4. **Single dispatch:** start at most one subprocess for the envelope.
5. **Registry running:** record `pid`, `startedAt` and `logPath`.
6. **Follow:** read bounded status/log evidence until terminal or timeout.
7. **Outcome:** build parent-side outcome from registry, log bytes and touched-file evidence.
8. **Promotion:** only the parent promotes task/board state after outcome and verification pass.

Workers do not promote themselves. A successful process exit is evidence, not completion by itself.

## Adapter Boundary

This document is the portable contract. Adapters are implementation details.

- A Pi adapter may translate the envelope into `pi --print`, tool allowlists and provider model refs.
- A local runner may translate it into `node`, `python`, or another bounded command.
- A provider adapter may add budget metadata, environment keys or model routing.

Adapters must not weaken the envelope. In particular, an adapter cannot turn missing declared files, missing approval, cwd mismatch, unexpected touched files or missing logs into a pass.

Repository scripts such as `agent-run-pi-provider-fanout-plan.mjs` and `agent-run-pi-provider-worker-dispatch.mjs` are local adapters and canaries for this contract. They are not the portable API by themselves.

## Touched Files Policy

For `fileContract=read-only`:

- `declaredFiles` must not be mutated;
- `touchedFiles` must be empty unless the parent explicitly defines an evidence artifact exception;
- unexpected files are blockers.

For mutation envelopes:

- mutation targets must be declared before dispatch;
- every touched file must be in the mutation target set;
- marker or test evidence must prove the intended mutation happened;
- missing touched-file evidence is at best partial, never pass.

## Not Promoted

This primitive does not promote:

- multi-file mutation by default;
- unattended fanout;
- protected scope;
- swarm execution;
- release/publish actions;
- automatic board updates by workers;
- worker-initiated next-worker dispatch.

Those capabilities need separate envelopes, gates and canaries. Passing this single-worker envelope is evidence for bounded worker execution only.

## Current Reference Implementation

The current local reference surface is `agent_run_driver_step_dispatch`:

- preview by default;
- structured approval for `execute=true`;
- planned -> running -> terminal registry lifecycle;
- optional bounded follow;
- optional embedded `agent-run-outcome-packet` when terminal.

The provider/model qualification evidence is tracked separately. A model passing one envelope does not inherit trust for another model or stronger envelope.
