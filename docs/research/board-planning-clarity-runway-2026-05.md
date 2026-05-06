# Board planning clarity runway — 2026-05

Status: local-safe planning/decomposition audit  
Tarefa: `TASK-BUD-878`  
Escopo: `.project/tasks.json`, sem unpark de protected tasks  
Regra: separar trabalho local-safe/documental de decisões protegidas; não iniciar provider/model/cost/API, pesquisa externa, colony promotion ou CI.

## Evidência inicial

- `board_planning_clarity_score`: **63**, `planning-clarity-needs-decomposition`.
- `board_dependency_hygiene_score`: **100**, `board-dependency-hygiene-strong`.
- `board_dependency_health_snapshot`: strong; sem missing deps, cycles ou protected coupling no sample.
- Open/in-progress relevantes após a runway arquitetural:
  - protected legacy colony promotions: `colony-c1-promotion`, `colony-c2-promotion`, `colony-c-123-promotion`, `colony-c-ret-1-promotion`;
  - protected external influence/research parked: `TASK-BUD-468`, `TASK-BUD-480`, `TASK-BUD-521`, `TASK-BUD-676`;
  - protected model infrastructure: `TASK-BUD-849`;
  - current architecture runway: `TASK-BUD-878`, `TASK-BUD-879`.

O problema não é dependência quebrada; é mistura de macro/parked/protected items no mesmo board visível para seleção. A correção deve ser por classificação e próximos packets explícitos, não por unpark automático.

## Decomposição por classe

| Classe | Itens | Natureza | Próxima ação segura |
| --- | --- | --- | --- |
| Colony promotion legacy | `colony-c1-promotion`, `colony-c2-promotion`, `colony-c-123-promotion`, `colony-c-ret-1-promotion` | Protected/external-ish; materialização de execução background/colony | Manter parked. Quando houver foco humano, primeiro criar packet de promoção com inventário/rollback/validação; não auto-promover. |
| External influence parked | `TASK-BUD-468`, `TASK-BUD-480`, `TASK-BUD-521`, `TASK-BUD-676` | Pesquisa externa ou assimilação de influência | Manter parked. Futuro local-safe só deve começar com intake documentado e sem fetch/remote automático; pesquisa externa requer foco explícito. |
| Model Infrastructure | `TASK-BUD-849` | Provider/model/cost/API strategy | Manter protected. Usar `TASK-BUD-879` como packet de entrevista; não alterar routing/settings/budgets. |
| Architecture runway | `TASK-BUD-879` | Preparação de entrevista, local-safe | Executar após `TASK-BUD-878`; produz perguntas e separa cleanup inferível de decisões humanas. |

## Splits recomendados, sem criar execução automática

### Colony promotion legacy

Cada promotion item deve futuramente virar dois passos, mas apenas sob foco humano:

1. **Inventory packet** (local-safe se artefatos já estão locais): listar candidate, arquivos, branch/worktree, validação possível, risco e rollback.
2. **Promotion decision** (protected): aplicar/promover candidate no branch alvo, rodar validação e pedir revisão humana.

Enquanto não houver foco, os quatro itens continuam `protected-parked-legacy`.

### External influence parked

Cada item deve futuramente virar:

1. **Influence intake packet**: objetivo, fonte, perguntas de valor/risco, limite de escopo, se precisa web/remote.
2. **Local synthesis**: só depois de fonte disponível ou pesquisa explicitamente autorizada; produzir doc de padrões aplicáveis.
3. **Promotion decision**: transformar padrão em backlog/task local, sem adotar runtime/scheduler externo automaticamente.

Para `TASK-BUD-676`, que hoje é mais solto, a decomposição explícita é:

- protected decision: autorizar pesquisa externa de `claude-mem`;
- local-safe follow-up pós-autorização: síntese de memória/sessão para continuidade local-first;
- protected promotion: qualquer mudança em memória/runtime/session semantics.

### Model Infrastructure

`TASK-BUD-849` já está corretamente parked; a decomposição imediata é `TASK-BUD-879`:

- perguntas de produto/provider/custo/API;
- separar cleanup local inferível de decisões humanas;
- bloquear alterações em routing/provider budgets/settings/API contracts.

Depois da entrevista, os próximos splits prováveis são:

1. **Provider tier taxonomy doc** — protected decision input, sem código;
2. **Cost policy model** — protected, requer limites humanos;
3. **Report-only leaderboard assimilation packet** — local-safe apenas se fonte/evidência já estiver local, senão protected external research;
4. **Routing implementation** — protected code/settings/API work.

## Regras de seleção local-safe

Para evitar que planning clarity volte a cair:

- tarefas com `protected-parked-*` não devem entrar na seleção local-safe sem `include_protected_scopes=true` e foco humano;
- tarefas de pesquisa externa devem declarar se exigem web/remote; se exigirem, ficam protected;
- tasks macro devem ter uma primeira fatia explícita: packet/audit/doc local-safe ou protected decision;
- tarefas de implementação protegida devem ter entrevista/decision packet antes de qualquer alteração de código/config;
- auto-close continua proibido quando `board_task_quality_gate` apontar blockers.

## Estado alvo após esta fatia

- Clarity melhora pela remoção do macro ativo `TASK-BUD-878` e pela explicitação de que os itens restantes são parked/protected, não próximos passos locais.
- Dependency hygiene permanece 100.
- Próxima execução local-safe deve ser `TASK-BUD-879`, porque é entrevista packet documental para `TASK-BUD-849` e não altera provider/model/cost/API.

## Validação recomendada

```bash
board_planning_clarity_score
board_dependency_hygiene_score
board_dependency_health_snapshot
```

Além disso, manter uma inspeção textual dos planned/in-progress tasks para confirmar que não houve unpark ou execução protected.
