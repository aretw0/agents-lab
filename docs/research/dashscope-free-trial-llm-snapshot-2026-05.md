# DashScope free-trial LLM quota snapshot — 2026-05

Status: operator-provided snapshot / report-only  
Task: `TASK-BUD-987`  
Purpose: preserve the available DashScope/Qwen LLM free-quota landscape before selecting control-plane and subagent models. This is not a routing change and does not authorize paid spend.

## Operational shortlist

| Role | Candidate | Why | Current action |
| --- | --- | --- | --- |
| Control plane fallback now | `dashscope/qwen-plus` | Already registered and smoke-proven; good balanced fallback for lighter cockpit work | usable now, but not a full `gpt-5.5` equivalent |
| Control plane candidate | `dashscope/qwen3.6-plus` | Newer plus tier with full free quota; likely best first candidate to relieve OpenAI cockpit usage | configure + canary before default |
| Control plane high-quality candidate | `dashscope/qwen3-max`, `dashscope/qwen-max` | Max tier has full quota and may handle harder planning | configure; use for protected/manual canaries first |
| Subagent/coder | `dashscope/qwen3-coder-plus`, `dashscope/qwen3-coder-next` | Coder family is the best candidate for delegated code/review work | configure + bounded agent-run canary |
| Cheap coder/subagent | `dashscope/qwen3-coder-flash` | Lower-cost coder-family candidate for small local-safe workers | configure; canary after plus/next |
| Monitor/classifier cheap | `dashscope/qwen3.6-flash` | Already registered; structured-output canary passed with thinking off | keep for lightweight tasks |
| Simple fallback | `dashscope/qwen-turbo` | Almost full quota, but not a cockpit-quality candidate | simple tasks only |
| Defer / non-LLM lane | VL, OCR, speech, MT, embedding models | Useful later, but not needed for text control plane | do not configure for this slice |

## Controls

- Do not change `defaultProvider` / `defaultModel` automatically.
- Keep OpenAI Codex as high-trust fallback and for harder subagents/review while Qwen cockpit canaries mature.
- Before making any DashScope model the default control plane, run a local-safe canary for: tool obedience, scope discipline, Portuguese/English governance prompts, and parent-side outcome.
- Use free-quota-only posture; stop if the dashboard or API indicates paid billing, quota exhaustion, 401/403/429, or unstructured/unsafe behavior.

## Operator-provided LLM free-quota snapshot

Captured from operator message. Non-LLM visual/multimodal/speech/embedding models were intentionally not listed by the operator except where they appeared in this LLM-oriented dashboard slice; model codes are preserved as provided.

| Model Code | Remaining Free Quota | Expiration Time |
| ---------- | -------------------- | --------------- |
| wen-max-latest | No free quota | - |
| qwen-plus-character-ja | No free quota | - |
| qwen-turbo-2024-11-01 | No free quota | - |
| qwen-plus-2025-01-25 | No free quota | - |
| qwen3.6-flash | Remaining 792,217 / Total 1,000,000 | 2026/08/04 |
| qwen-plus | Remaining 965,141 / Total 1,000,000 | 2026/06/05 |
| qwen-turbo | Remaining 999,621 / Total 1,000,000 | 2026/06/05 |
| qvq-max-2025-03-25 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-235b-a22b-thinking | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen2.5-vl-72b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-plus-2025-05-07 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-plus-2025-07-28 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-plus-latest | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen2.5-vl-3b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-max | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen2.5-14b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-mt-flash | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-30b-a3b-thinking | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.6-plus | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen2.5-7b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-32b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-max-2025-08-13 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-plus | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.5-35b-a3b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-max-2025-01-25 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-coder-480b-a35b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-coder-plus | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-8b-thinking | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-max-preview | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.5-flash-2026-02-23 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-flash-2025-10-15 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-8b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen2.5-14b-instruct-1m | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-0.6b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-coder-flash | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qvq-max | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-plus-2025-08-15 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-max-latest | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-next-80b-a3b-thinking | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.5-27b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-flash | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen2.5-32b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-14b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-turbo-latest | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-max-2025-09-23 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-plus-character | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-flash-character | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-30b-a3b-instruct-2507 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qvq-max-latest | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-flash | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-flash-2025-07-28 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-235b-a22b-instruct-2507 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-coder-plus-2025-07-22 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.5-plus-2026-04-20 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-ocr | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-ocr-2025-11-20 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.5-122b-a10b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-max-2025-04-08 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen2.5-7b-instruct-1m | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-max | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.5-plus-2026-02-15 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-235b-a22b-thinking-2507 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen2.5-vl-7b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.6-max-preview | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.5-397b-a17b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-plus-2025-09-23 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| deepseek-v3.2 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-coder-next | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.5-flash | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-30b-a3b-thinking-2507 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen2.5-72b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-coder-plus-2025-09-23 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-plus-latest | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-max-2026-01-23 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-plus-2025-09-11 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| wan2.2-kf2v-flash | Remaining 50 / Total 50 | 2026/08/04 |
| qwen3-vl-flash-2026-01-22 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-max | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-30b-a3b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-235b-a22b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-coder-30b-a3b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-4b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.6-27b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-235b-a22b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-mt-lite | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-vl-plus-2025-01-25 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-1.7b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.6-flash-2026-04-16 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-plus | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-turbo-2025-04-28 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-30b-a3b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen2.5-vl-32b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-mt-plus | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-8b-instruct | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-coder-flash-2025-07-28 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3-vl-plus-2025-12-19 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-plus-2025-04-28 | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen-mt-turbo | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.5-plus | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |
| qwen3.6-35b-a3b | Remaining 1,000,000 / Total 1,000,000 | 2026/08/04 |

## Next canaries

1. `dashscope/qwen3.6-plus`: cockpit/control-plane planning canary, report-only.
2. `dashscope/qwen3-coder-plus`: small local-safe agent-run/code review canary.
3. `dashscope/qwen3-coder-next`: alternate coder candidate if plus is slow/overkill.
4. `dashscope/qwen3-max`: high-quality planning comparison, no default until measured.
