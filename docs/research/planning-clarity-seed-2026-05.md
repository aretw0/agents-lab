# Planning clarity seed — 2026-05

Status: decomposição local-safe  
Escopo: board aberto e fila de limpeza/alinhamento  
Regra: este documento não fecha tarefas automaticamente e não promove protected scope.

## Diagnóstico

- Planning clarity score: 63 (`planning-clarity-needs-decomposition`).
- Tarefas abertas antes da decomposição: 9 efetivas, com 2 macro/estratégicas.
- Protected parked permanece separado de trabalho local-safe.
- `TASK-BUD-849` permanece médio prazo/protected por envolver providers, custo, API e assimilação externa.

## Packs separados

### Pack A — local-safe imediato: UI cohesion

Objetivo: remover JSON cru de `content` em tools report-only, preservando `details` estruturado.

Seed criado:

1. `TASK-BUD-859` — `git_maintenance_status` summary-first.
2. `TASK-BUD-860` — `tool_hygiene_scorecard` e `agents_as_tools_calibration_score` summary-first.
3. `TASK-BUD-861` — `background_process_*` summary-first.
4. `TASK-BUD-862` — `subagent_readiness_status` summary-first.
5. `TASK-BUD-863` — `session_analytics_query` summary-first.

Validação padrão por fatia:

- teste smoke focal da surface;
- `operator-visible-output` smoke quando aplicável;
- board verification antes de completar;
- commit pequeno por fatia.

Rollback padrão: reverter os arquivos da fatia e a verification correspondente.

### Pack B — arquitetura watch

Objetivo: impedir crescimento silencioso antes de voltar a features maiores.

Referência: `docs/research/pi-stack-line-budget-watch-2026-05.md`.

Próximas opções locais:

- inventário de registrations/exports em `guardrails-core.ts`;
- inventário de famílias em `guardrails-core-autonomy-lane-surface-helpers.ts`;
- prep de extração pura em `monitor-provider-patch.ts` sem alterar runtime.

### Pack C — protected parked / humano explícito

Não executar automaticamente:

- `TASK-BUD-849` — Model Infrastructure médio prazo.
- Pesquisas externas parked (`TASK-BUD-468`, `TASK-BUD-480`, `TASK-BUD-521`, `TASK-BUD-676`).
- Promoções legacy de colônia.

Esses itens precisam de foco humano porque podem envolver provider/custo/API externa, pesquisa externa, ou materialização protegida.

## Entrevista necessária?

Não para os packs A e B. Eles são limpeza interna, local-safe, reversível e com validação focal.

Sim para decisões como:

- quais providers/tetos de custo entram no Model Infrastructure;
- quando aceitar pesquisa externa recorrente;
- quando promover colônia ou delegação além de rehearsal local;
- critérios de produto para novas features.

## Critério para voltar a arquitetura forte

Voltar para evolução maior quando:

1. Pack A estiver majoritariamente concluído ou restarem apenas tools com protected execute path.
2. Pack B tiver inventário suficiente para impedir crescimento acima de 1000 linhas sem extração deliberada.
3. Handoff/board estiverem limpos, com fila local-safe e protected parked separados.
4. Readiness de agents-as-tools estiver legível o bastante para delegar sem sobrecarregar o control plane.

## Próxima fatia recomendada

Executar `TASK-BUD-859` e seguir em cadeia até `TASK-BUD-863`, parando em compact/checkpoint ou falha de teste.
