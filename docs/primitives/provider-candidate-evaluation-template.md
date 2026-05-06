# Provider candidate evaluation template

Status: template / report-only  
Use before: changing `routeModelRefs`, `providerBudgets`, default provider/model, monitor-provider overrides, API keys, or routing automation.

## 1. Candidate identity

| Field | Value |
| --- | --- |
| Provider name |  |
| Model ref proposed |  |
| Intended role | monitor/classifier / local-safe implementation / review / long-context / fallback / other |
| Owner/account |  |
| Evaluation date |  |
| Source task |  |

## 2. Human/operator facts

Record dashboard/provider facts separately from local estimates.

| Field | Value |
| --- | --- |
| Official dashboard quota remaining |  |
| Official reset date/time |  |
| Timezone/reset uncertainty |  |
| Plan type | free / pro / team / enterprise / unknown |
| Known hard cap |  |
| Known rolling window |  |
| Has the operator ever been blocked? | yes / no / unknown |
| Manual evidence link/screenshot path |  |

## 3. Local quota policy

| Field | Value |
| --- | --- |
| Is provider in `providerBudgets`? | yes / no |
| Local budget unit | tokens / requests / USD / mixed / unknown |
| Local period | daily / weekly / monthly / rolling / unknown |
| Local warn threshold |  |
| Local hard threshold |  |
| Current local state | ok / warning / blocked / unknown |
| Known mismatch with dashboard? |  |
| Calibration action needed |  |

Rule: if local `blocked` conflicts with official dashboard headroom, call it `policy-blocked` until caps/units/reset are reconciled.

## 4. Telemetry coverage

| Signal | Status | Notes |
| --- | --- | --- |
| Session logs include provider name | yes / no / unknown |  |
| Token usage captured | yes / no / unknown |  |
| Cost captured | yes / no / estimated / unknown |  |
| Request count captured | yes / no / inferred / unknown |  |
| 429/auth/server errors captured | yes / no / unknown |  |
| Appears in `quota_visibility_status` | yes / no / unknown |  |
| Appears in `quota_alerts` | yes / no / unknown |  |
| Appears in `provider_readiness_matrix` | yes / no / unknown |  |

If telemetry is missing, keep candidate at report-only or manual-canary level.

## 5. Cost-benefit estimate

| Dimension | Answer |
| --- | --- |
| Expected cost unit |  |
| Expected cost per 100 monitor calls |  |
| Expected cost per local-safe slice |  |
| Quality hypothesis |  |
| Latency hypothesis |  |
| Context window |  |
| Tool/function calling support |  |
| Structured output reliability |  |
| Main benefit vs current provider |  |
| Main risk vs current provider |  |

## 6. Privacy and protected scope

| Question | Answer |
| --- | --- |
| Can receive conversation excerpts? | yes / no / unknown |
| Can receive tool call summaries? | yes / no / unknown |
| Can receive file paths? | yes / no / unknown |
| Can receive code snippets? | yes / no / unknown |
| Can receive protected scope content? | no by default / yes with explicit decision |
| Data retention terms reviewed? | yes / no / unknown |
| Any prohibited paths/scopes? |  |

Default: unknown privacy means no protected scope and no automatic routing.

## 7. Monitor/classifier suitability

| Check | Result |
| --- | --- |
| Cheap enough for high-frequency calls | yes / no / unknown |
| Low enough latency for monitor loop | yes / no / unknown |
| Stable structured verdict | yes / no / unknown |
| Handles lean prompts | yes / no / unknown |
| Handles Portuguese/English mixed context | yes / no / unknown |
| Expected false positive risk | low / medium / high / unknown |
| Expected false negative risk | low / medium / high / unknown |

Initial monitor allowlist proposal:

- allowed first:
- excluded until review:
- never allowed without protected decision:

## 8. Canary plan

| Field | Value |
| --- | --- |
| Canary type | report-only / manual one-shot / small monitor batch |
| Human approval required | yes |
| Max calls |  |
| Max cost |  |
| Max duration |  |
| Allowed files/scope |  |
| Validation method |  |
| Baseline comparison |  |
| Evidence artifact path |  |

Suggested phases:

1. report-only packet;
2. manual one-shot with synthetic or archived monitor cases;
3. small monitor batch with explicit cap;
4. advisory-only route candidate;
5. protected activation.

## 9. Stop conditions

Stop immediately if any apply:

- auth/credential error;
- repeated 429/rate-limit;
- invalid structured verdict;
- unexpected protected-scope exposure;
- unknown or unbounded cost;
- local quota telemetry missing after canary;
- severe quality miss on safety/authorization cases;
- operator dashboard disagrees with local budget in a way not yet explained.

## 10. Rollback plan

| Mechanism | Ready? | Notes |
| --- | --- | --- |
| `.pi/settings.json` snapshot | yes / no |  |
| Commit revert | yes / no |  |
| Feature flag disable | yes / no |  |
| Restore previous `classifierModelByProvider` | yes / no |  |
| Clear runtime/reload needed | yes / no |  |

No rollback, no activation.

## 11. Decision summary

Decision: candidate-only / canary-ready / advisory-ready / activation-ready / blocked

Reason:

Required human decision before next step:

- [ ] provider allowed?
- [ ] model ref allowed?
- [ ] budget cap accepted?
- [ ] privacy scope accepted?
- [ ] canary cap accepted?
- [ ] rollback accepted?
- [ ] activation remains manual/report-only?
