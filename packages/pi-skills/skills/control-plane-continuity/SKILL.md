---
name: control-plane-continuity
description: >
  Use when a Pi session needs to continue local-safe work with low operator friction:
  discover focus, interview only for missing constraints, prepare bounded slices,
  use workers only behind gates, checkpoint, and stop on real risk.
---

# Control-plane continuity

Use this skill when the operator asks for continued progress, a larger local-safe batch, or a fresh session needs to recover the continuity profile without rereading long project history.

## Operating Frame

- Treat this as a control-plane profile, not a scheduler, executor, swarm, or unattended service.
- Prefer one useful local-safe slice over a long plan.
- Before a larger batch or worker discussion, use `environment_runtime_health_status` when available; if it returns `safe-mode` or `stop-and-investigate`, reduce surface or stop before adding work.
- Do not execute Pi TUI slash commands such as `/watchdog:status` through bash or worker shell. Those are operator input commands; for agent-readable runtime health, use `environment_runtime_health_status` and `environment_dev_pressure_status`.
- If the operator asks to validate runtime health, mentions watchdog, or pastes `/watchdog:*` commands as intent, pass that text to `operator_intent_intake_packet`; the packet can infer the read-only runtime-health route. Do not translate the pasted slash commands into shell commands.
- If the operator asks whether workers/subagents are ready or safe to use, pass that text to `operator_intent_intake_packet`; the packet can infer the read-only worker-readiness route. Readiness checks do not prepare or dispatch a worker.
- Convert free-form intent through `operator_intent_intake_packet` before asking broad follow-up questions or preparing workers.
- After intake, follow `details.controlPlaneAction` and `details.executionPlan`: if it is `run-report-only-route`, `confirmationRequired=false`, and `executionPlan.executeWithoutTextualConfirmation=true`, run `executionPlan.steps` in order and summarize; do not ask the operator to confirm a non-mutating packet.
- Ask a short interview only when the intake reports missing focus, validation, rollback, budget, or stop conditions.
- Use first-party packets before free-form judgment: `operator_intent_intake_packet`, `project_intake_plan`, `structured_interview_plan`, `control_plane_profile_packet`, `local_batch_manifest_packet`, `context_watch_continuation_readiness`, `context_watch_local_slice_preview`, `local_continuity_loop_canary_packet`, `context_watch_checkpoint`.
- If the operator explicitly authorizes read-only diagnostics, or says not to ask for confirmation, do not answer with a permission question such as "Quer que eu rode?". Run the relevant first-party read-only packets and return a compact decision.
- Delegate to workers only after the lower agent-run gates are green; batch intent never bypasses per-worker start/outcome gates.
- Stop on protected scope, unknown validation, unexpected git state, budget block, compact/reload pressure without checkpoint, repeated failure, or real operator/product ambiguity.

## Assisted Self-Critique

This is an assisted loop, not unattended automation.

- Reduce micro-authorization by using the existing mature gates.
- Keep the operator available for real ambiguity, protected scope, reload/compact, host pressure, budget blocks, and failed outcomes.
- Treat failures as evidence: observe, record the smallest useful fact, harden the contract or toolkit, then continue only when the next slice is still local-safe.
- Treat reload, compact, and host pressure as operational interventions, not as a reason to pretend the loop can continue blindly.
- Ask for help when the evidence requires it; do not ask for help just to avoid a bounded local-safe step.

## Short Interview

Ask only what is missing:

1. What is the single focus or seed for the next slice?
2. What validation proves the slice?
3. What files or scope are allowed?
4. What rollback is acceptable?
5. What should force a stop?

If the operator already gave enough context, do not repeat the interview. Convert it into a local-safe packet and proceed with the smallest reversible slice.

When a TUI choice surface is available, prefer the choices from `operator_intent_intake_packet.details.interaction`: render `uiHints.preferred=choice-list`, preselect `recommendedChoiceId`, select a route, accept a custom answer, or cancel. If no widget is available, summarize the same choices in one compact message.

## Default Slice Contract

Before editing:

- one focus task;
- declared files or a clear reason to inspect before editing;
- known focal validation;
- rollback by git;
- no protected scope unless explicitly authorized;
- checkpoint planned.

After editing:

- run focal validation;
- stage only intentional files;
- commit a small atomic change when validation passes;
- record board verification and checkpoint;
- stop after one slice unless a fresh canary decision says another local-safe slice is still appropriate.

## Worker Use

Use workers when they reduce latency or isolate review, not because the control-plane is avoiding responsibility.

- Prefer read-only review workers before mutation workers.
- Keep each worker to declared files, timeout, provider/model budget, and one outcome packet.
- Use `operator_intent_intake_packet` to decide whether the intent is ready for `agent_run_operator_packet`; intake never starts a worker.
- Use `agent_run_batch_dry_run` for planned batch runIds; it is evidence only.
- Do not start protected, scheduler, remote/offload, GitHub Actions, publish, settings, or credential work through this skill.

## Output Shape

Keep responses short:

```text
decision: continue-local | checkpoint | ask-operator | blocked
focus: <task or seed>
next: <one bounded action>
validation: <gate>
stop: <condition if relevant>
```

Do not cite bare task IDs without a short label or action. Do not promise autonomous looping; describe the next bounded slice and the condition that would make it stop.
