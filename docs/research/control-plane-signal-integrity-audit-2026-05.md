# Control-plane signal integrity audit — maio 2026

## Objetivo

Reduzir retrabalho causado por sinais/gates falsos no control-plane. O foco é detectar sinais que induzem continuidade errada, bloqueio stale ou decisão operacional incorreta antes de avançar novas features.

## Incidente raiz

`reloadGate=reload-not-required` retornou falso-negativo depois de mudanças em runtime de extensão (`monitor-provider-output.ts`). A lógica humana sabia que `/reload` era necessário, mas o gate só observava o próprio `context-watchdog`, settings e agent overrides.

Correção já aplicada:

- `TASK-BUD-942`
- `fix(context): detect extension source reload needs`
- regressão: `packages/pi-stack/test/smoke/context-watchdog-runtime-reload.test.ts`
- regra: observar também `packages/pi-stack/extensions/*.ts`

## Classes de falha

| Classe | Exemplo | Risco | Resposta desejada |
|---|---|---:|---|
| falso continuar | reload necessário reportado como clear | alto | regressão obrigatória + fail-closed |
| falso bloqueio | compact/checkpoint antigo persiste após reload/checkpoint | médio | stale/advisory + prefilter |
| divergência entre superfícies | status diz clear, readiness bloqueia pelo mesmo motivo | alto | teste de consistência cruzada |
| sinal sem evidência | ready/eligible sem dirty/freshness válido | alto | details estruturados + reason code |
| sinal crítico suprimido | protected/destructive/unauthorized tratado como stale | crítico | nunca suppress sem evidência forte |

## Inventário inicial de sinais críticos

| Sinal/tool | Decisão influenciada | Falha perigosa | Cobertura atual | Gap/ação ROI |
|---|---|---|---|---|
| `context_watch_compact_stage_status.reloadGate` | pedir reload antes de continuar | falso `reload-not-required` | `context-watchdog-runtime-reload.test.ts` cobre settings/agents/source dirs | adicionar consistência com auto-resume/operator surfaces |
| `context_watch_freshness_status.dirty` | permitir continuidade local | falso clean/dirty | `git_dirty_snapshot`, freshness status manual | regressão para dirty board vs source vs clean real |
| `context_watch_continuation_readiness` | continuar/pausar lane | candidate/stop stale ou ready indevido | testes de continuation + local audit | teste de stale handoff pós-completion |
| `local_continuity_audit.stagnationSignal` | pausar/replanejar loop travado | falso bloqueio ou ausência de pausa | `guardrails-unattended-continuation-surface.test.ts` cobre `pause-human-replan` | cobrir que sinal é advisory e não vira dispatch |
| `monitor_stale_feedback_prefilter` | evitar classifier em feedback stale/duplicado | suprimir finding crítico fresco | `monitor-runtime-contract` e `monitor-summary` | caso negativo crítico deve ficar `allow-classifier` |
| `monitor_empty_response_evidence` | distinguir empty real vs stale | falso empty-response | evidência JSONL tail | cobrir resposta subsequente não-vazia como superseded |
| `autonomy_lane_next_task` / status | escolher próxima fatia | focus mismatch bloqueia indevidamente ou escolhe protected | selector tests existentes | regressão para task concluída no handoff não bloquear sucessor local-safe |
| `auto_advance_hard_intent_telemetry` | delegação/auto-advance | eligible sem evidência | telemetry report-only | manter fail-closed até cobertura madura |
| `provider_readiness_matrix` / quota alerts | roteamento humano | provider pronto quando quota bloqueia | quota tests parciais | comparar readiness vs quota block em packet único |
| protected-scope classifiers | mutação protegida | falso safe | protected scope reports/packets | teste de não promoção sem opt-in |

## Priorização de regressões

P0 — já iniciado:

1. `reloadGate` observa mudanças de extensão pi-stack fora do context-watchdog. Coberto por `context-watchdog-runtime-reload.test.ts`.
2. `monitor_stale_feedback_prefilter` não suprime sinais críticos frescos. Coberto por `monitor-runtime-contract.test.ts` com `unauthorized-action`/protected/destructive fresh.

P1 — próxima onda:

3. Consistência cruzada: `compact_stage`, `auto_resume_preview` e `operator stop` devem concordar sobre reload required/clear. Parcialmente coberto por `context-watchdog.test.ts`: reload em janela `ok` fica não ativo em pre-compact, mas segue visível para operator/stop/action e o nextAction da compact-stage aponta `/reload`, não `continue bounded work`.
4. Dirty/freshness: dirty source ou board deve impedir strong continuation; clean real não deve bloquear por dirty stale.
5. Handoff stale: task concluída no board não deve manter `focus-mismatch`/`candidate:invalid` sem sugestão de sucessor.

P2 — depois:

6. Provider/quota readiness combinado: provider bloqueado por quota não pode aparecer como rota preferida sem warning.
7. Protected-scope preservation: nenhum prefilter/brainstorm/autonomy packet promove protected scope sem opt-in explícito.

## Política de teste

- Preferir testes puros e determinísticos sobre testes que dependem da sessão viva.
- Cada sinal crítico precisa de pelo menos um caso positivo e um caso negativo quando possível.
- Para sinais que dependem de runtime live, testar o helper puro e adicionar smoke de superfície apenas para shape/summary.
- Regressões devem validar `reasonCode`, não apenas booleanos.
- Falhas com risco de falso continuar devem ser fail-closed.

## Critério de pronto da lane

A lane pode ser considerada madura quando houver:

- inventário versionado dos sinais críticos;
- cobertura P0 completa;
- pelo menos duas regressões P1 implementadas;
- policy explícita para sinais críticos não suprimíveis;
- board/handoff limpos e commits pequenos por fatia.

