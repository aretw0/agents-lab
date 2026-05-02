# Perfil local de continuidade sem empurrão do control-plane

Status: perfil operacional local-first para `TASK-BUD-421`; não é uma nova primitive e não troca o vocabulário canônico. “Overnight” é só um cenário/alias de uso para a direção já existente de `nudge-free` / `local continuity audit`: continuar fatias locais sem empurrão constante, com checkpoint, validação e stop conditions. Não ativa scheduler, remote/offload, GitHub Actions, subagentes, swarms ou promotion de colony. Serve para preparar o board e pacotes de decisão para atuação humana posterior.

## Martelo das primitivas

A decisão canônica é **não criar uma família nova de loops**. O control-plane deve compor poucas primitivas já existentes ou explicitamente desejadas:

| Primitiva | Papel | Estado operacional |
| --- | --- | --- |
| `local_continuity_audit` | Ler o estado local e dizer se existe uma próxima fatia local-safe. | Read-only/advisory; não executa. |
| `nudge_free_loop_canary` | Avaliar se uma continuação sem empurrão humano poderia ser segura. | Read-only/advisory; boolean humano não libera `ready`. |
| `context_watch_checkpoint` | Gravar handoff curto entre fatias e antes de compact/pausa. | Mutação bounded de checkpoint; não despacha execução. |
| `autonomy_lane_next_task` | Selecionar conservadoramente uma task local-safe do board. | Read-only; `no-eligible-tasks` é stop condition. |
| `autonomy_lane_auto_advance_snapshot` | Auditar decisão hard-intent de auto-advance após `focus-complete` (`eligible` vs `blocked`). | Report-only/read-only; fail-closed para protected/risk/reload/validation unknown. |
| `autonomy_lane_material_readiness_packet` | Medir prontidão de material da lane AFK (`continue|seed-backlog|blocked`) com foco e cobertura de validação. | Report-only/read-only; sem dispatch e com stop explícito para estoque baixo. |
| `turn_boundary_decision_packet` | Explicar parada/continuação no boundary do turno (`continue|checkpoint|pause|ask-human`) com `humanActionRequired` e `nextAutoStep`. | Report-only/read-only; sem dispatch e com motivo canônico auditável. |
| Board bounded (`board_query`, `board_task_create`, `board_task_complete`, `board_decision_packet`) | Manter task/evidência/decisão recuperável. | Mutação limitada ao board quando chamada explicitamente. |
| One-slice contract | Executar uma única fatia local e parar. | Contrato futuro/guardado; não é loop permanente. |

Portanto, “overnight”, “loop maior”, “deixa rodando” e “sem empurrão” devem mapear para o mesmo contrato: **nudge-free/local-continuity em batches pequenos**, não scheduler e não swarm.

Quando houver intenção de testar delegação, a transição é via `simple_delegate_rehearsal_packet` (report-only). Sem `decision=ready`, não há promoção para rehearsal delegado.

Abastecimento mínimo para runs AFK:
- manter 3–7 fatias local-safe prontas no board;
- semeadura via `lane_brainstorm_packet` + `lane_brainstorm_seed_preview` com decisão humana explícita;
- quando ficar abaixo do mínimo, emitir `stop: backlog-material-insuficiente` e priorizar materialização antes de continuar.

## Objetivo

O perfil local de continuidade deve adiantar trabalho que o control-plane já sabe fazer com segurança:

- triage do board;
- decomposição de macro-tasks em side quests;
- decision packets para escolhas humanas;
- pesquisa bounded já explicitamente selecionada;
- consolidação de handoff/verification/checkpoint;
- redução de ambiguidade para o operador atuar no dia seguinte.

Ele não deve tentar “fazer tudo”. A meta da manhã seguinte é: board limpo, opções claras, riscos classificados e tarefas humanas prováveis separadas.

## Rota de modelo/provedor

Estado atual: usar Codex como rota simples do control-plane. O retorno de cota do GitHub Copilot é uma boa notícia para orquestração futura, mas não muda automaticamente settings nem provider.

Regras:

- não alterar `.pi/settings.json`;
- não executar `quota_visibility_route(... execute=true)` sem pedido explícito;
- registrar WARN/BLOCK de provider como blocker, não como auto-switch;
- tratar Copilot/GitHub como capacidade futura para orquestração, não como dependência do loop simples atual.

## Unidade de trabalho

Uma volta do loop é uma fatia pequena:

1. escolher uma task local-safe ou criar uma side quest local-safe explícita;
2. declarar arquivos e método de validação antes de editar;
3. executar só triage/docs/board/pesquisa bounded;
4. validar com `safe_marker_check`, structured-read, board gate ou teste focal conhecido;
5. registrar verification ou note;
6. escrever checkpoint curto;
7. commitar somente arquivos da fatia;
8. parar ou reavaliar stop conditions antes da próxima volta.

## Batch local sem empurrão

Para um primeiro batch controlado, o tamanho recomendado é pequeno:

- máximo de 3 a 5 fatias;
- máximo de 1 pesquisa externa bounded por batch;
- máximo de 1 novo primitive design por batch;
- commit por fatia;
- checkpoint após cada fatia;
- handoff final com `focus`, `done`, `blocked`, `next human decisions`.

Isso evita acordar com um branch grande, difuso ou difícil de revisar.

## Permitido

O loop pode fazer:

- `board_query`, `board_task_quality_gate`, `board_decision_packet`;
- criação/decomposição de tasks via superfícies bounded;
- docs locais em `docs/guides`, `docs/primitives` e `docs/research`;
- pesquisas bounded já selecionadas pelo operador;
- inventário read-only de candidates, sem materializar;
- análise de status/readiness com tools advisory/read-only;
- commits pequenos com validação focal.

## Bloqueado

O loop deve parar antes de:

- GitHub Actions/CI;
- remote/offload;
- publish/release;
- alteração de `.pi/settings.json`;
- promotion/materialização de colony no branch alvo;
- subagentes/swarms executando trabalho;
- scheduler ou repetição persistente;
- limpeza destrutiva de git (`git gc`, `git prune`, remover `.git/gc.log`);
- pesquisa externa ampla sem pergunta definida;
- qualquer diff inesperado fora da fatia.

## Stop conditions

Parar e registrar checkpoint quando ocorrer:

- `context_watch_status` em `compact` ou warning final;
- reload necessário;
- provider WARN/BLOCK sem rota explicitamente escolhida;
- teste/validação falha sem correção óbvia;
- task protegida é a próxima opção;
- `autonomy_lane_next_task` retorna `no-eligible-tasks`;
- dirty state inesperado aparece;
- `machine_maintenance_status` sinaliza pressão relevante de memória/disco/CPU (e swap quando disponível);
- decisão humana real é necessária.

## Pacote de maturidade para run local longa (report-only)

Antes de considerar outros modos, consolidar um pacote de evidência com métricas mínimas observáveis de uma run local longa, sem scheduler/remote/offload:

- `slicesCompleted` (meta inicial: 3-5 fatias consecutivas);
- `focalValidationPassRate` (meta: 100% nas validações focais da run);
- `unexpectedDirtyCount` (meta: 0);
- `protectedAutoSelectionCount` (meta: 0);
- `checkpointFreshnessViolations` (meta: 0);
- `rollbackNeededCount` (meta: 0 ou justificativa explícita);
- `noEligibleStopHandled` (meta: sempre tratado como stop condition, sem drift);
- `boardEvidenceCoverage` (meta: cada fatia com verification/handoff curto).

Critério de go/no-go da run local longa:

- **go para novo rehearsal local**: todas as métricas acima dentro da meta em pelo menos um batch completo;
- **no-go para modos protegidos**: qualquer violação crítica (protected auto-selection, falta de checkpoint, drift sem evidência, validação focal falhando sem correção);
- **ação padrão quando no-go**: abrir side quest local-safe de hardening e repetir rehearsal.

Este pacote é **report-only**: ele mede maturidade, não autoriza automaticamente CI/remote/offload/scheduler.

## Saída esperada para a manhã seguinte

O pacote de handoff final deve responder:

- quais fatias foram concluídas;
- quais commits foram criados;
- quais decisões humanas ficaram prontas;
- quais tarefas estão bloqueadas e por quê;
- qual é a próxima ação segura;
- o que explicitamente não foi autorizado.

Formato sugerido:

```text
nudge-free-local-continuity: slices=<n> commits=<n> protectedTouched=no remote=no scheduler=no nextHuman=<decisão> blockers=<lista curta>
```

No fechamento de boundary, incluir a provocação direcional canônica do packet `turn_boundary_decision_packet`:
- "continue in a similar lane to consolidate, or switch to the next lane with higher long-term value?"

Template curto de checkpoint pós-rehearsal real (1 task):

```text
rehearsal-postflight: decision=<go|no-go> task=<id> validation=<pass|fail> rollback=<none|applied> blockers=<lista-curta> next=<ação-segura>
```

Template curto de handoff material-first (AFK low-iteration):

```text
afk-handoff: decision=<continue|seed-backlog|blocked> stock=<validationKnown>/<target> blockers=<lista-curta|none> next=<ação-segura>
```

Campos mínimos do template material-first:
- `decision`: saída de prontidão (`continue|seed-backlog|blocked`);
- `stock`: cobertura de fatias local-safe validadas (`validationKnown/target`);
- `blockers`: razões de parada objetivas (`none` quando vazio);
- `next`: próxima ação segura e curta.

Esse template é intencionalmente compacto para reduzir atrito em runs AFK e manter a decisão humana explícita no retorno.

## Primeiro foco recomendado

Antes de usar colônias, subagentes ou swarms, o primeiro batch local sem empurrão deve exercitar o próprio control-plane com trabalho de baixo risco:

1. preparar packets de decisão para backlog protegido/ambíguo;
2. decompor inspirations bounded em primitives pequenas;
3. inventariar candidates de colony em modo read-only;
4. deixar o board pronto para decisões humanas, sem aplicar candidates.

O sucesso desse cenário não é um nome novo nem uma automação nova: é o operador conseguir voltar depois de um período longo e escolher rapidamente entre decisões já preparadas, sem encontrar automação irreversível já executada.
