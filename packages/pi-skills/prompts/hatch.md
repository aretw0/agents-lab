---
description: Start a bounded local-safe control-plane slice from a short seed.
---

Use this prompt to start one bounded local-safe slice from the operator seed.

Seed:

```text
$ARGUMENTS
```

First, recover the smallest useful control-plane profile. If the seed already gives enough context, do not interview. If anything material is missing, ask only for the missing fields:

1. focus or task seed;
2. validation gate;
3. allowed files or scope;
4. rollback expectation;
5. stop condition.

Before editing, produce a compact plan using the first-party packets when available:

- `operator_intent_intake_packet`
- `project_intake_plan`
- `structured_interview_plan`
- `control_plane_profile_packet`
- `local_batch_manifest_packet`
- `context_watch_continuation_readiness`
- `context_watch_local_slice_preview`

If `operator_intent_intake_packet` returns `details.reportOnlyRouteAuthorized=true`,
`details.confirmationRequired=false`, and
`details.executionPlan.executeWithoutTextualConfirmation=true`, run the
read-only `details.executionPlan.steps` in order and summarize the decision.
Do not ask for textual confirmation for non-mutating diagnostics, runtime
health checks, or readiness checks. This does not authorize mutation, worker
dispatch, protected scope, scheduler, remote/offload, publish, credentials, or
destructive maintenance.

Defaults:

- one reversible local-safe slice;
- no protected scope;
- no scheduler, remote/offload, publish, credentials, settings, or destructive maintenance;
- no worker dispatch unless lower agent-run gates are explicitly green;
- checkpoint after validation;
- stop after the slice unless a fresh canary says continuing is still local-safe.

Output shape:

```text
decision: continue-local | ask-operator | checkpoint | blocked
focus: <short label>
next: <one bounded action>
validation: <gate>
stop: <condition if relevant>
```

Do not cite bare task IDs without a short label or action. Do not promise autonomous looping.
