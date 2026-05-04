# Ops Calibration Decision Packet (primitive)

## Objetivo

Compor os resultados de calibração de background process e agents-as-tools em um único packet report-only para decidir:

- `keep-report-only`
- `ready-for-bounded-rehearsal`

## Surface

- Tool: `ops_calibration_decision_packet`
- Tool complementar: `simple_delegate_rehearsal_packet`
- Fontes:
  - `packages/pi-stack/extensions/guardrails-core-ops-calibration.ts`
  - `packages/pi-stack/extensions/guardrails-core-ops-calibration-surface.ts`

## recommendationCode

- `ops-calibration-ready-bounded-rehearsal`
- `ops-calibration-keep-report-only-background`
- `ops-calibration-keep-report-only-agents`
- `ops-calibration-keep-report-only-threshold`
- `ops-calibration-keep-report-only-reload`

## Uso recomendado

1. calcular `background_process_readiness_score` (padrão por inferência bounded e, opcionalmente, com overrides `has_*` para contraste);
2. avaliar `background_process_rehearsal_gate` para confirmar evidências mínimas de rehearsal;
3. calcular `agents_as_tools_calibration_score`;
4. avaliar `evaluateAgentSpawnReadiness` (simple spawn bounded) para obter sinal de spawn readiness;
5. chamar `ops_calibration_decision_packet` com `live_reload_completed=true` para decisão consolidada.

O packet aplica o mesmo padrão de inferência bounded de background capabilities quando `has_*` não é informado, respeita overrides explícitos quando fornecidos e mantém `keep-report-only` enquanto o sinal de `background_process_rehearsal_gate` não estiver em `decision=ready`.

Para promoção de `simple-delegate` sem abrir dispatch, use `delegation_readiness_status_packet` como cue primário: o packet agora expõe `operationalRunway` (delegação + background) com recomendação `local-execute|simple-delegate|defer` e blockers normalizados. Em seguida confirme no `simple_delegate_rehearsal_packet`, que compõe capability + mix + auto-advance telemetry em decisão `ready|needs-evidence|blocked`, também com `authorization=none`, `dispatchAllowed=false` e `mutationAllowed=false`.

Regra pragmática de long run AFK: antes de promover rehearsal, garantir **material** no board (via `lane_brainstorm_packet` + `lane_brainstorm_seed_preview` + decisão humana de semeadura). Sem material local-safe suficiente, a recomendação correta é continuar em triagem/limpeza/pesquisa bounded.

## Invariantes

- `dispatchAllowed=false`
- `authorization=none`
- sem start/stop de processo
- sem execução automática de agentes
