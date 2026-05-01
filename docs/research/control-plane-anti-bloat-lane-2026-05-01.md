# Lane anti-gordura do control-plane (local-first)

Data: 2026-05-01
Status: proposta operacional local-safe para manter o control-plane produtivo sem cair em repetição neurótica.

## Contexto

Objetivo do operador: desbloquear o potencial do control-plane para limpar excessos das tentativas anteriores e preparar maturidade para modos futuros, **sem** ativar CI/remote/offload/scheduler agora.

### Tentativa de inspiração externa (Claude Code)

Foi tentada uma rodada de brainstorm via `claude_code_execute` com prompt bounded de lane local-first. Resultado:

- subprocesso executado, mas retornou: `You've hit your limit · resets 1:20pm (America/Sao_Paulo)`.
- decisão: usar fallback local (este packet) para não bloquear a lane.

## Princípios da lane

1. Fatias pequenas, reversíveis e auditáveis.
2. Uma mudança estratégica por fatia; nada de repetir patch similar sem ganho de contrato.
3. Sempre com validação focal + rollback simples.
4. Sem escopos protegidos automáticos.
5. Quando `no-eligible-tasks`, parar e escolher foco explicitamente.

## Backlog de fatias sugeridas (8-12)

| Slice | Tema | Valor | Risco | Validação focal | Rollback |
| --- | --- | --- | --- | --- | --- |
| S1 | Packet anti-gordura + semeadura de backlog | cria direção unificada | virar doc sem execução | marker-check + board sync | revert doc/task entries |
| S2 | Centralizar semântica de stop local entre surfaces | reduz drift de mensagens/códigos | acoplamento ruim | smoke autonomy/context-watch | revert helper wiring |
| S3 | Checklist curto de poda por fatia | evita repetição sem estratégia | checklist virar burocracia | marker-check em doutrina | revert docs |
| S4 | Teste cross-surface de recommendationCode/nextAction | previne regressão silenciosa | teste frágil | vitest focal | revert test additions |
| S5 | Critérios de maturidade para run local longa (report-only) | define go/no-go objetivo | confundir com autorização | marker-check + i18n lint | revert docs |
| S6 | Inventário de duplicação de parsing params em tools core | reduz gordura técnica | mexer em área estável sem foco | smoke focal por módulo | revert refactor |
| S7 | Consolidar helpers de resumo/summary sem perder legibilidade | reduz strings soltas | over-abstraction | snapshot/smoke de summary | revert helper extraction |
| S8 | Guardrail: impedir "plan=go" com "selection stop" sem nextAction explícita | elimina ambiguidade de runtime | alterar contrato de saída | smoke surface contract | revert payload shape |
| S9 | Playbook de “quando parar” por reason code | decisões mais rápidas | duplicar o que já existe | marker-check no doctrine | revert docs |
| S10 | Pacote de evidência de rehearsal local (3-5 slices) | prova maturidade com dados | gerar ruído de métricas | checklist + verifications | revert packet doc |

## Semeadura inicial no board

Materializado neste ciclo:

- `TASK-BUD-431` (in-progress): este packet e semeadura.
- `TASK-BUD-432` (planned): centralização semântica stop-local.
- `TASK-BUD-433` (planned): checklist de poda de gordura.
- `TASK-BUD-434` (planned): teste cross-surface de contrato.
- `TASK-BUD-435` (planned): pacote de maturidade de run local longa (report-only).

## Estratégia de execução recomendada

Ordem sugerida para manter valor alto e risco baixo:

1. S1 (`TASK-BUD-431`) – fechar direção.
2. S2 (`TASK-BUD-432`) – reduzir drift semântico.
3. S4 (`TASK-BUD-434`) – proteger contrato por teste.
4. S3 (`TASK-BUD-433`) – consolidar estratégia anti-gordura.
5. S5 (`TASK-BUD-435`) – definir evidência de maturidade para run longa.

## Critério de sucesso desta lane

A lane é considerada bem-sucedida quando:

- os pacotes `recommendationCode/nextAction` ficam consistentes entre surfaces;
- novas fatias não repetem refactor sem objetivo explícito;
- existe checklist leve para poda de gordura;
- existe pacote de métricas para rehearsal local longa sem liberar modos protegidos.
