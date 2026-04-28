# Monitor Curation Master Plan

Date: 2026-04-28  
Status: Draft for rollout gating (pre-default-on)

## Objective

Centralize guardrail behavior under `/monitors` with explicit profile governance, so monitors can stay **on by default** without:

- unnecessary LLM cost,
- noisy steering that blocks good milestone work,
- mode-coupling regressions (control-plane vs subagent/swarm).

---

## Current snapshot

Monitors discovered (project local):

- `unauthorized-action` (event=`tool_call`, when=`always`, ceiling=1, L3:block)
- `fragility` (event=`message_end`, when=`has_file_writes`, ceiling=5, L2:confirm)
- `hedge` (event=`turn_end`, when=`has_bash`, ceiling=4, L1:advisory)
- `commit-hygiene` (event=`agent_end`, when=`has_file_writes`, ceiling=2, L1:advisory)
- `work-quality` (event=`command`, when=`always`, ceiling=3, on-demand)

All currently disabled (intentional during review).

Profiles present in `.pi/monitors/profiles/`:

- `balanced` (default)
- `exploratory`
- `strict`

---

## Curation matrix (value x cost)

| Monitor | Primary value | Risk if missing | Cost pressure | LLM really needed? | Recommendation |
|---|---|---:|---:|---|---|
| unauthorized-action | Prevent critical irreversible ops pre-exec | **Very high** | High (fires on tool_call) | Partially (semantic authorization) | Keep always-on, but add deterministic prefilter to avoid classify on obviously safe read-only calls |
| fragility | Avoid “left broken state” after writes | High | Medium | Yes | Keep on in control-plane; stricter trigger in swarm/subagent lanes |
| hedge | Keep response aligned with user intent | Medium | Medium | Yes | Keep advisory; lower priority and shorter context window |
| commit-hygiene | Maintain commit/verification discipline | Medium | Low-Medium | Mostly yes (intent-sensitive) | Keep advisory; avoid triggering during exploratory sessions |
| work-quality | Deep quality review | Medium | **Low (on-demand)** | Yes | Keep command-only (`/work-quality`) |

---

## Deterministic-first cost controls (mandatory before default-on)

1. **Pre-classify filters**
   - Skip LLM classify when trigger is obviously safe/non-applicable.
   - Example: `unauthorized-action` bypass for read-only commands (`read/ls/find/grep/status`).

2. **Context minimization**
   - Prefer short-window bounded context only.
   - Avoid `conversation_history` unless monitor requires it for correctness.

3. **Escalation ladder discipline**
   - L1 advisory (never block)
   - L2 explicit confirmation
   - L3 critical block only

4. **Ceiling + cooldown hygiene**
   - Keep low repeated-steer loops from increasing token burn.

5. **Keep `work-quality` command-only**
   - no automatic turn-by-turn classify.

---

## Mode policy proposal

### control-plane (default productive lane)
- ON: `unauthorized-action`, `fragility`, `hedge`, `commit-hygiene`
- ON-DEMAND: `work-quality`
- Profile base: `balanced`

### subagent / swarm
- ON: `unauthorized-action` only (L3 critical)
- Optional ON: `fragility` with tighter trigger only if proven low-noise
- OFF by default: `hedge`, `commit-hygiene` (avoid throttle/noise in delegated loops)
- `work-quality` remains command-only

### exploratory/dev-local
- ON: `unauthorized-action`
- Advisory monitors with higher ceilings (`exploratory`)

---

## Activation gate (must pass)

Before switching to default-on:

- [ ] Profile rationale published (why this profile, for which mode)
- [x] Deterministic prefilter for `unauthorized-action` implemented in runtime contract patch (read/status/query/read-only shell bypass)
- [ ] Noisy false-positive classes documented + mitigation rules
- [ ] Cost budget target defined (classify calls / hour by mode)
- [ ] Smoke pass with monitors ON in control-plane canonical loop
- [ ] Rollback command documented (`/monitors off` + profile fallback)

---

## Operator runbook (minimal)

- Inspect: `/monitors`
- Temporary pause: `/monitors off`
- Resume: `/monitors on`
- Monitor details: `/monitors <name>`
- Calibrate rule: `/monitors <name> rules add <text>`
- Reset monitor state: `/monitors <name> reset`

---

## Decision policy

- If a monitor increases cost/noise without protecting milestone continuity, it must be downgraded (trigger/context/ceiling) or moved to on-demand.
- If a monitor guards irreversible risk, it stays on, but with deterministic prefilter to minimize LLM usage.
- `/monitors` is the canonical namespace for policy visibility and human control.
