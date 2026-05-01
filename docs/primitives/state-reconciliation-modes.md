# Reconciliação de estado por modo de execução

Status: política local-first parcial para `TASK-BUD-153`; não inicia CI, remoto, scheduler nem merge operacional; não fecha prontidão ininterrupta sozinha.

## Objetivo

Definir como reconciliar artefatos de estado (`board`, `settings`, `handoff`) quando o trabalho passa por modos diferentes: nativo/local, container e CI/PR-MR. A meta é permitir trabalho ininterrupto com segurança e controle sem transformar evidência stale em estado atual.

## Decisão base

Enquanto a calibração local-first não estiver madura, o modo padrão é:

- `runtimeMode=native`;
- `deliveryChannel=direct-branch` para fatias locais pequenas;
- sem CI/remote/offload automático;
- board/handoff atualizados por superfícies bounded;
- settings canônico protegido, com overlays derivados quando necessário.

`pull-request`/`merge-request` são canais de promoção/revisão, não autorização para rodar CI/remoto automaticamente.

## Resultados de planejamento determinístico

Evidência desta fatia:

| Caso | Resultado | Política |
| --- | --- | --- |
| `delivery_mode_plan()` | `runtime=native`, `channel=direct-branch`, `provider=none` | Aplicação local direta só quando gates locais estão verdes. |
| `delivery_mode_plan(preferChannel=pull-request)` | `runtime=native`, `channel=pull-request`, `provider=none` | Usar PR para promoção reviewable em lanes compartilhadas. |
| `state_reconcile_plan(board, native, direct-branch, 1 writer)` | risco baixo | `lock-and-atomic-write`. |
| `state_reconcile_plan(settings, native, direct-branch, 2 writers)` | risco médio, review manual | `lock-and-atomic-write`, `single-writer-branch`, `generated-apply-step`. |
| `state_reconcile_plan(settings, container, pull-request, 2 writers)` | risco médio, review manual | Também requer `reviewed-promotion`. |
| `state_reconcile_plan(handoff, ci, merge-request, 4 writers)` | risco alto, review manual | `single-writer-branch`, generated apply e promoção revisada. |

## Políticas por artefato

### Board

O board é a fonte operacional de tarefas, status e verificação. Para fatias locais:

- usar `board_task_create`, `board_update`, `board_verification_append` e `board_task_complete`;
- manter escrita lock/atomic quando houver ferramentas automatizadas;
- evitar scripts ad hoc como hot path;
- se houver múltiplos escritores, designar um single-writer ou gerar patch/apply step revisável.

### Settings

`.pi/settings.json` é baseline canônico protegido.

- não reescrever automaticamente em loops, containers ou canários;
- mudanças exigem intenção explícita, snapshot/rollback e review humano;
- variações temporárias pertencem a overlays derivados, por exemplo `.pi/derived-settings/<agent-id>.settings.json`;
- promoção de overlay para settings canônico precisa de tarefa separada.

### Handoff

`handoff` é evidência de continuidade, não substituto de estado real.

- checkpoint deve ser fresco antes de compact/reload/retomada;
- não tratar handoff stale como foco atual quando o board já mudou;
- auto-resume deve reconciliar `focusTasks` com status do board e preferir o estado mais recente;
- múltiplos escritores exigem single-writer ou generated apply step, especialmente em CI/MR.

## Matriz go/no-go

| Situação | Decisão |
| --- | --- |
| local native, um escritor, board/handoff bounded | pode continuar localmente |
| local native com settings canônico sujo | parar e pedir decisão/snapshot |
| container com overlays derivados e board single-writer | candidato a rehearsal local |
| PR/MR para promoção de docs/código já validado | permitido como plano/review, não execução automática |
| CI/remote/offload criando ou reconciliando estado | bloqueado até tarefa explícita e gates maduros |
| múltiplos agentes escrevendo board/settings/handoff sem single-writer | no-go |

## Fluxo recomendado para trabalho ininterrupto seguro

1. Selecionar fatia local-safe pelo board/handoff.
2. Atualizar status via board bounded.
3. Executar mudança pequena e reversível.
4. Validar por teste/marker/structured-read.
5. Registrar verification e completar task.
6. Escrever checkpoint curto com foco/validação/next actions.
7. Commitar apenas arquivos da fatia.
8. Reconciliar `git status`, context level e board antes da próxima fatia.

## Limite desta primitiva

Esta política cobre reconciliação de estado, mas não basta para declarar execução ininterrupta multi-modo pronta. Ainda faltam primitivas operacionais para controle de background process, cancelamento/fallback de long-run, curadoria/ergonomia de tools expostas, reconciliação live de stale handoff vs board e validação medida em rehearsal local.

## Bloqueios preservados

Esta política não autoriza:

- scheduler/loop forte;
- remote/offload;
- GitHub Actions/CI automático;
- publish;
- alteração automática de `.pi/settings.json`;
- resolução automática de conflitos de múltiplos escritores;
- limpeza git destrutiva.

Esses caminhos precisam de tarefa explícita, evidência local e decisão humana.
