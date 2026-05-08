# Agent-run provider-native runner — 2026-05

## Intent

Operational galvanization for the lab: use agents to remove execution load from the control plane while the control plane keeps deciding what matters. Blog/newsletter/public output are consequences, not goals.

The immediate target is not more curation. It is a small, observable, provider-native `agent run` path that can execute one bounded local-safe slice with status, log, abort, and parent-side outcome.

## Current evidence

- First real `TASK-BUD-986` worker was planned as `openai-codex/gpt-5.3-codex-spark` but actually executed through `claude_code_execute`.
- The subprocess exited `0` with `output_bytes=0`; process success was correctly separated from contract success (`contractDecision=fail`).
- Monitor/empty-response evidence must not be conflated with worker evidence. The control-plane JSONL empty assistant turn and the worker empty log are separate facts.
- Current post-reload context is clear; stale context/reload blockers are now tracked separately by `TASK-BUD-990`.
- Provider budget signal at this slice: `openai-codex` is cost-pressure blocked in local monthly budgeting, while `dashscope` free-trial budget is still ok. This does not prove quality, only availability/cost posture.

## Candidate execution paths

| Path | Value | Risk / gap | Current decision |
| --- | --- | --- | --- |
| `pi -p --model provider/model` subprocess | Provider-native, explicit model, uses Pi provider registry, easy stdout/stderr capture, bounded tools via CLI flags. | Still subprocess-based; must isolate cwd/session/logs and fail on empty stdout. | **First implementation candidate** for one worker. |
| Pi SDK `AgentSession` embedded runner | Strongest long-term integration: model registry, event stream, lifecycle hooks. | More code and tighter coupling; harder to get right before one CLI canary. | Second wave after CLI runner proves contract. |
| `pi-workflows` | Existing DAG/checkpoint system and agent specs. | Can hide low-level process/log/outcome details if used too early. | Use after one-run contract is reliable. |
| Direct provider API call | Smallest request surface for read-only review. | Bypasses Pi tools/session semantics and does not cultivate Pi-native subagents. | Only for monitor/classifier micro-calls, not agent-run lane. |
| `claude_code_execute` | Available diagnostic subprocess. | Provider mismatch, empty output incident, separate auth/budget semantics. | Old path / fallback only; not primary. |
| `ant_colony` / multiple workers | Throughput and exploration. | Too much surface before single-run status/log/abort/outcome passes repeatedly. | Blocked until 2–3 clean one-worker runs. |

## Minimum viable runner contract

The first provider-native runner should be deliberately narrow:

1. **No dispatch by packet alone**: docs, task notes, or `agent_run_plan` never authorize execution.
2. **Executor identity is explicit**: record `executorKind=pi-print-subprocess`, binary/path, `providerModelRef`, cwd, prompt path/hash, declared files, tool allowlist, timeout.
3. **Provider/model is enforced**: command must include `--model provider/model`; mismatch between planned and actual model is a contract failure.
4. **Session isolation**: use a run-specific session dir or `--no-session`; keep control-plane board as single writer.
5. **Tool scope is bounded**: first runs should be read-only (`read,grep,find,ls`) unless the human explicitly confirms an editing run.
6. **Registry before start**: `planned -> running` with pid/log/status paths before provider request.
7. **Bounded log**: capture stdout/stderr, exit code, output bytes, start/end timestamps, and command metadata.
8. **Abort path**: registered pid only, human-confirmed abort for execute=true.
9. **Outcome parent-side**: empty output fails even with exit `0`; unexpected touched files fail; missing markers fail.
10. **No auto-retry**: retries require a new explicit human decision and a changed reason/scope.

## Provider order

1. **DashScope/Qwen canary for cheap local-safe reviews** while free-trial budget is ok. Good first target: read-only review output where quality can be judged by parent markers.
2. **OpenAI Codex Spark when budget pressure allows or human explicitly overrides**, because it remains a high-trust candidate for code agents but local budget currently says blocked.
3. **OpenAI Codex high-trust fallback** for critical review/hard control-plane tasks, not routine agent-run burn.

This order is budget-aware, not a statement that DashScope is higher quality. Quality must be proven by bounded runs.

## Good first test candidates

- `TASK-BUD-990`: stale context/reload auto-resume cleanup. Small, deterministic, high operator-value, easy tests.
- `TASK-BUD-988`: monitor empty-response/context-divergence fixtures. Good for read-only analysis and regression proposal.
- `TASK-BUD-968`: quota footer/panel UI review. Already parked with focal tests; good read-only review material, but do not close it from agent output alone.

## Next local-safe slice

Implement a report-only start packet or runner design helper before any dispatch:

- inputs: `runId`, `executorKind`, `providerModelRef`, `cwd`, `prompt`, `declaredFiles`, `timeoutMs`, `toolAllowlist`, `sessionIsolation`, `logPath`;
- output: ready/blocked, exact command preview, budget/readiness caveats, required human confirmation phrase;
- tests: model mismatch blocks, protected scope blocks, empty output marker is mandatory, read-only allowlist default.

Only after that packet is tested should the operator be asked whether to execute exactly one worker.

## TASK-BUD-1001 small-mutation canary

First agent-first small-mutation protocol with economyMode=critical:

- Goal: mutate exactly one declared file with minimal context restatement
- Constraint: declaredFiles-only access, output <=20 lines, token conservation
- Validation: exact file change verification, no auto-retry without human decision

## Subagent promotion ladder after first canary

The lane is now open, but promotion is evidence-based rather than a jump to parallelism:

1. Repeat 1-2 tiny single-worker canaries with explicit human confirmation, fresh budget evidence, declared files, economy critical/conserve, and parent-side outcome packets.
2. Promote to one small code mutation only after repeated non-empty outputs, expected touched files, focal validation, and control-plane commits.
3. Keep multi-worker/colony/background blocked until status/log/abort/outcome, process lifecycle, budget, and stop-condition behavior are green across several slices.
4. Treat compact with dirty state or `recommendation=stop` as expected fail-closed auto-resume behavior; checkpoint/commit first, then choose the next worker deliberately.

**Second-canary rule**: Repeat calibrated single-worker canaries before code-mutation promotion; no parallel/background; parent outcome packet required.
