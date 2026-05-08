# OpenAI Codex dual-quota calibration — 2026-05

Status: local-safe diagnostic and hardening plan. No provider/settings/routing changes in this slice.

## Operator evidence

The operator reported that the OpenAI Codex dashboard shows two relevant quotas:

- general OpenAI Codex weekly window: about 50% available; later operator evidence said the normal pool can be around 30% remaining;
- `gpt-5.3-codex-spark` model-specific pool: about 82-83% available;
- expected general reset: 2026-05-11, possibly one day earlier;
- expected `gpt-5.3-codex-spark` reset: 2026-05-13.

This conflicts with the local quota route advisory that marks `openai-codex` as blocked.

## What the local gate currently does

Current `.pi/settings.json` configures `openai-codex` under `piStack.quotaVisibility.providerBudgets` as one monthly aggregate budget:

- period: monthly;
- unit: tokens-cost;
- monthly token cap: 1,200,000,000;
- monthly cost cap: 500 USD;
- warn: 85%;
- hard: 98%.

`buildProviderBudgetStatuses()` currently:

- groups by provider/account, not by model-specific quota pool;
- infers a monthly period from monthly caps;
- starts the period at local month start;
- computes both used percentage and projected end-of-period percentage;
- chooses the maximum of used and projected percentages across tokens/cost/requests;
- blocks when that maximum crosses `hardPct`.

Observed local evidence for `openai-codex` in this session:

- used tokens: about 44.9%;
- used cost: about 69.6%;
- projected tokens: about 232%;
- projected cost: about 359%;
- resulting local state: blocked.

So the local block is not saying the dashboard quota is exhausted. It is saying the configured monthly aggregate projection would overshoot the configured local cap.

## Why this is misleading for routing

The local model is too coarse for OpenAI Codex because it treats all `openai-codex` usage as one provider-level monthly pool. That loses at least four important facts:

1. The real user-visible quota is weekly, not monthly.
2. The dashboard has a separate `gpt-5.3-codex-spark` quota/pool.
3. Reset dates differ between the general Codex window and the Spark pool.
4. Routing decisions need per-model availability, not only provider aggregate pressure.

This means `openai-codex` can look blocked locally even when `gpt-5.3-codex-spark` has usable quota.

## Local/community research evidence

Local pi docs show that native model configuration mainly describes model cost metadata and usage accounting in provider responses; it does not expose a first-party quota-window schema for dashboard reset windows or per-model subscription pools.

A community plugin already solves a closely related part of this problem. `@ifi/oh-pi-extensions` includes a `usage-tracker` extension described as a CodexBar-inspired provider quota and cost monitor. Its README header says it tracks provider-level rate limits for Anthropic, OpenAI, and Google using pi-managed auth while also tracking per-model token usage locally.

Relevant source evidence from `ifiokjr/oh-pi` at commit `efe02e90df29ba8a2c426b9195024e52d6178d95`:

- OpenAI probe uses pi-managed auth and calls `GET /backend-api/wham/usage`: https://github.com/ifiokjr/oh-pi/blob/efe02e90df29ba8a2c426b9195024e52d6178d95/packages/extensions/extensions/usage-tracker-providers.ts#L513-L547
- The source comment says this endpoint exposes active 5-hour/weekly windows plus additional model-specific limits: https://github.com/ifiokjr/oh-pi/blob/efe02e90df29ba8a2c426b9195024e52d6178d95/packages/extensions/extensions/usage-tracker-providers.ts#L513-L518
- It converts `used_percent`, `limit_window_seconds`, `reset_after_seconds`, and `reset_at` into percent-left/reset windows: https://github.com/ifiokjr/oh-pi/blob/efe02e90df29ba8a2c426b9195024e52d6178d95/packages/extensions/extensions/usage-tracker-providers.ts#L463-L492
- It reads `additional_rate_limits` and labels them from `limit_name` or `metered_feature`, which is the likely path for model-specific pools such as `gpt-5.3-codex-spark`: https://github.com/ifiokjr/oh-pi/blob/efe02e90df29ba8a2c426b9195024e52d6178d95/packages/extensions/extensions/usage-tracker-providers.ts#L591-L605
- Its top-level extension persists rolling 30-day cost history and last known provider rate-limit snapshots, allowing stale-but-useful windows when live probes are unavailable: https://github.com/ifiokjr/oh-pi/blob/efe02e90df29ba8a2c426b9195024e52d6178d95/packages/extensions/extensions/usage-tracker.ts#L1-L27

Implication: we should not invent this entirely from logs. The hardening should import/adapt the direct OpenAI WHAM usage probe pattern, cache snapshots, and then reconcile live dashboard windows with local session projections.

## Hardening requirements

A better quota model should support:

- provider-level quota windows and model-specific quota windows;
- explicit reset anchors, not only calendar month/week starts;
- fixed-window weekly quotas and possibly rolling-window quotas as separate concepts;
- route decisions that evaluate `provider/model` candidates instead of only provider names;
- separate states for `usedPct` and `projectedPct`, so projection pressure can warn without falsely claiming dashboard exhaustion;
- an operator override/evidence field for dashboard-observed remaining percentages until an API scrape/import exists;
- compact operator output that explains why a provider/model is blocked or allowed.

## Proposed local schema direction

Illustrative shape only; not applied in this slice:

```json
{
  "openai-codex": {
    "period": "weekly",
    "unit": "tokens-cost",
    "resetAtIso": "2026-05-11T00:00:00-03:00",
    "dashboardRemainingPct": 50
  },
  "openai-codex/gpt-5.3-codex-spark": {
    "period": "weekly",
    "unit": "requests",
    "resetAtIso": "2026-05-13T00:00:00-03:00",
    "dashboardRemainingPct": 83
  }
}
```

## Routing implication for the next canary

Until this is hardened, treat the local `openai-codex` blocked state as **aggregate-projection pressure**, not definitive provider exhaustion.

Safe routing guidance:

- `dashscope/qwen3.6-flash`: currently preferred by the local route advisory for conservative canaries.
- `openai-codex/gpt-5.3-codex-spark`: plausible candidate for a bounded canary if the operator explicitly chooses to trust dashboard evidence over the aggregate local projection.
- Do not auto-switch or edit provider settings from this diagnostic.

## Validation plan for implementation

Future implementation should add local tests for:

- provider-level budget and model-specific budget evaluated separately;
- reset-anchored weekly period start/end;
- dashboard remaining percentage recorded as evidence without pretending to be measured from logs;
- route advisory considering `provider/model` candidates;
- projection pressure downgraded to warning when dashboard remaining evidence says the real pool is available.
