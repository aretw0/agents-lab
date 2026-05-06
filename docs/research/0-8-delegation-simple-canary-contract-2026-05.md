# 0.8 simple-delegate canary contract — 2026-05

## Decision state

Status: report-only contract. This document does not authorize dispatch, scheduler, remote/offload, GitHub Actions, provider/settings changes, or protected-scope work.

Recommendation: defer execution until a human explicitly approves one named canary task and the rehearsal gate no longer reports `focus-missing` for the selected focus.

## Candidate canary shape

- Agents: exactly one simple worker agent.
- Scope: one local-safe task only; no repeat loop.
- Timeout: 120000 ms.
- Working directory: isolated cwd/worktree must be known before start.
- Budget: bounded before start; no unbounded provider spend.
- Files: declared before start; first candidate should prefer docs/tests/fixtures over runtime settings.
- Protected scopes: forbidden by default (`.pi/settings.json`, providers, CI/GitHub Actions, publish, remote/offload, `.obsidian`, destructive maintenance).
- Rollback: non-destructive `git restore -- <declared files>` or discard isolated worktree.
- Validation: focal command/marker must be known before dispatch.
- Stop contract: stop after one slice; control plane reviews diff and decides integration.

## Current readiness evidence

- `agent_spawn_readiness_gate`: ready for one simple spawn when timeout/cwd/budget/rollback/scope are declared.
- `subagent_readiness_status`: READY in strict mode.
- `provider_readiness_matrix`: one provider ready, one blocked.
- `simple_delegate_rehearsal_start_packet`: blocked; reasons include `rehearsal-not-ready`, `auto-advance-blocked`, `auto-advance-telemetry-not-ready`, and `focus-missing`.
- `delegation_readiness_status_packet`: local-execute-first; collect bounded evidence before dispatch.

## Minimum green path before asking for human approval

1. Select exactly one concrete local-safe focus task, preferably p1/p2, with declared files.
2. Run local validation manually once from the control plane.
3. Confirm the candidate has rollback, timeout, budget, and stop-after-one-slice contract.
4. Re-run `simple_delegate_rehearsal_start_packet` with declared files/validation/rollback signals.
5. Ask the operator for an explicit decision if the packet moves from blocked to ready-for-human-decision.

## Explicit non-goals

- No autonomous dispatch from this document.
- No scheduler/repeat behavior.
- No remote/offload or GitHub Actions.
- No provider/settings mutation.
- No protected parked backlog promotion.

## Suggested first candidate profile

Pick or create a p1/p2 local-safe task that changes only a small doc or smoke-test fixture, with a deterministic validation command. The worker goal should be phrased as a one-slice edit request, not as broad exploration.
