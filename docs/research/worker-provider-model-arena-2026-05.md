# Worker provider/model arena — 2026-05

Status: design-first, report-only by default

## Why this exists

The current worker maturity evidence is scoped to the provider/model that actually ran the canary. It must not be treated as universal. A new provider/model should not force us to rebuild the whole maturity ladder manually, but it also should not inherit trust for free.

This arena turns the ladder into repeatable canaries with explicit budgets and comparable outcomes.

This is **not** a colony/swarm abstraction. It is a serial test suite for model/provider capability evidence. The goal is to avoid hardcoded capability assumptions while still allowing a proven provider/model to use every envelope it has passed with evidence.

## Prior-art discipline

The arena must not become an isolated self-dialogue. Each new envelope or promotion rule should start from external prior art, known harnesses, community findings, or cached source evidence when available, then compare those findings with local scorecard rows.

Required evidence before treating an arena decision as mature:

- source links or local cached evidence for external benchmark designs and agent-runner primitives considered;
- a short comparison between external findings and our local constraints;
- explicit notes on which external primitive is adopted, adapted, or rejected;
- license, security, budget, and governance checks for borrowed primitives;
- unsupported claims labelled as hypotheses, not evidence.

## Non-negotiable boundaries

- No settings/routing/default-provider changes from arena runs.
- No protected content, credentials, CI, publish, or remote side effects.
- No automatic retry loops by default.
- Paid/model calls require explicit operator approval with provider/model, max calls, timeout, and budget evidence.
- Promotion is scoped to `(provider, model, envelope)`; passing one envelope/model does not promote another.
- Once a provider/model passes an envelope, it may be used for that evidenced capability without rematuring the whole ladder.

## Envelopes

| Envelope | File contract | Tools | Scope | Promotion meaning |
| --- | --- | --- | --- | --- |
| `readonly-one-file` | read-only | `read` | 1 declared file | model can inspect one file and produce contracted output |
| `readonly-two-file-synthesis` | read-only | `read`, `grep` | 2 declared files | model can compare narrow local evidence without looping |
| `readonly-one-symbol-review` | read-only | `read`, `grep` | 1 file / named symbol | model can recommend parent-side patch without mutation |
| `mutation-one-file-marker` | mutation | `read`, `write` or `edit` | 1 declared file | model can make one tiny declared-file mutation; parent validates touched file + marker |
| `failure-contract` | read-only | `read` | synthetic failing prompt | model/runtime reports missing evidence or fails closed without looping |

Not promoted yet: broad read-only analysis, two-file open-ended code/test review, multi-file mutation, parallel fan-out, unattended dispatch, protected scopes.

## Budget packet per run

Each real arena run must carry:

```json
{
  "providerModel": "provider/model-id",
  "envelope": "mutation-one-file-marker",
  "maxCalls": 1,
  "timeoutMs": 90000,
  "maxEstimatedCostUsd": 0.25,
  "maxOutputLines": 20,
  "retryPolicy": "none",
  "stopOn": ["401", "403", "429", "quota exceeded", "rate limit", "empty output", "unexpected touched file"],
  "budgetEvidence": "route/provider budget snapshot or manual dashboard evidence",
  "confirmationPhrase": "exact one-run phrase"
}
```

## Outcome schema

Each run records a row with:

- provider/model;
- envelope;
- processState;
- contractDecision;
- outputBytes;
- touchedFiles;
- marker/test results;
- latencyMs;
- errorClass;
- budget evidence and estimated burn;
- log path;
- commit/verification id if promoted.

## First implementation slice

Implemented in source as `buildAgentRunSdkProviderModelArenaPacket` and surfaced as `agent_run_sdk_provider_model_arena_packet` after reload.

1. Keep local smokes deterministic: no model call.
2. Add report-only arena packet that expands a provider/model + envelope into exact run specs and budget gates.
3. Seed fixtures for the five envelopes above.
4. Attach a prior-art intake packet before broadening the envelope set.
5. Use the existing `agent_run_follow` + `agent_run_outcome_packet` for real runs.
6. Emit a scorecard table; do not auto-promote settings/routing.

## Promotion rule

A provider/model is eligible for a worker envelope only when:

- the exact envelope canary passed;
- output contract passed;
- touched files were within declared mutation targets;
- budget stayed within packet limits;
- no protected scope was involved;
- evidence is recorded in board/verification.

Promotion is always additive and scoped: `openai-codex/gpt-5.3-codex-spark` passing `mutation-one-file-marker` does not imply `dashscope/qwen3-coder-plus` or any other model has passed it.

The positive rule is just as important: once a provider/model has passed an envelope, the control plane can use that provider/model for all capabilities covered by the passed envelopes, without re-running unrelated manual maturity exercises.
