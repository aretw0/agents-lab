# Matriz de validação — fatias local-safe 0.8.0

Data: 2026-05-06  
Task: `TASK-BUD-922`  
Lane: `0.8-local-safe-compounding-lane`

## Objetivo

Padronizar o menor gate confiável para fatias recorrentes da lane local-safe. A matriz reduz perguntas óbvias, evita validação excessiva e mantém rollback simples.

## Matriz

| Classe de fatia | Escopo permitido | Gate mínimo | Rollback cue | Stop condition |
|---|---|---|---|---|
| Docs-only | `docs/**`, sem prometer runtime novo | `safe_marker_check` nos anchors principais; i18n lint para texto user-facing novo | reverter commit de docs | link externo/protected research virar requisito antes de decisão humana |
| Board-only | `.project/tasks.json`, `.project/verification.json`, `.project/handoff.json` via tools estruturadas | `board_dependency_health_snapshot` e/ou `board_planning_clarity_score` | reverter commit de board | fechamento de task sem verificação ou decisão de produto |
| Test-only | `test/**`, `packages/*/test/**` sem mudar runtime | teste focal do arquivo alterado | reverter commit de teste | teste exigir mudança de comportamento não aprovada |
| Helper puro/report-only | módulos sem dispatch, sem side effects externos | smoke focal com assertiva no-dispatch/report-only | reverter commit de helper+teste | helper precisar acionar processo, rede, provider ou scheduler |
| Cleanup documental | dedupe, links, nomes, índices | marker/path check; diff pequeno | reverter commit de cleanup | limpeza tocar arquivos gerados/protegidos sem confirmação |
| Delegation readiness | docs/packets/readiness sem spawn | readiness/status packet read-only + marker check | reverter commit de docs/packet | qualquer despacho real de subagente/swarm/colony |
| Long-run prep | handoff, stop conditions, rollback docs | `context_watch_continuation_readiness` + marker check | reverter commit | scheduler, auto-reload ou remote/offload entrar no escopo |
| Monitor-economy prep | templates/evidência, sem runtime apply | marker check + evidência board/commit citada | reverter commit de docs | mudar monitor/provider/settings ou rodar `/monitor-provider apply` |
| CI/CD prep | template e análise report-only | marker check + nenhuma mudança em `.github/workflows/**` | reverter commit de docs | mutação de workflow ou uso de runner remoto |

## Regra de suficiência

Use o menor gate que detecta regressão provável da fatia. Escalar para `pnpm run ci:smoke:gate` apenas quando a fatia alterar comportamento compartilhado ou contrato runtime.

## Regra de rollback

Se o rollback não couber em um commit revert, a fatia deve ser quebrada antes de começar.

## Resumo operacional

- Docs: marker/i18n.
- Board: health/clarity.
- Código report-only: smoke focal + no-dispatch.
- Runtime compartilhado: smoke focal, depois gate amplo se necessário.
- Protegido: parar antes de mutar.
