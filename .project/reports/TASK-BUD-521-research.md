# Research: TASK-BUD-521 — Influência externa parked: avaliar futuramente `mattpocock/sandcastle`

**Executor:** diagnóstico local-first (sem execução nova de `ant_colony`)
**Data:** 2026-06-02
**Budget usado:** $0.00 de $2.00
**Status:** parcial (motivo: planejamento/execução não atingiu a fase de research)

## Objetivo

Executar a fase 1 do plano de pesquisa para `TASK-BUD-521` em `deliveryMode: report-only` com contratos de governança de modelo explícitos, validando que o objetivo técnico previsto poderia ser investigado no `mattpocock/sandcastle`.

## Fontes Consultadas

- `.project/reports/TASK-BUD-521-planning-failure.md`
- `.project/reports/TASK-BUD-521-executor-propagation-gap.md`
- `.pi/colony-retention/c1.json`
- `packages/pi-stack/extensions/colony-pilot.ts`
- `packages/pi-stack/extensions/colony-pilot-runtime.ts`
- `packages/pi-stack/test/smoke/colony-pilot-model-propagation-contract.test.ts`

## Síntese

A task foi bloqueada por falha de execução da colônia `c1` antes de iniciar pesquisa útil: o planejamento terminou com `No valid execution plan after 2 recovery rounds. Issues: no_pending_worker_tasks` e não houve geração de `TASK-BUD-521-research.md` durante a execução.

A análise técnica mostrou um gap de execução no contrato de propagação de modelos entre chamada do `ant_colony` e o estado do executor: os `scoutModel/workerModel/soldierModel` informados na chamada não estavam refletidos no runtime `state.json` no campo `modelOverrides`, gerando desvio de rastreabilidade e inviabilizando a pesquisa em fase de report-only com roles pretendidas.

Foi implementada a validação de contrato de propagação em `colony-pilot.ts` com registro `pi.appendEntry("colony-pilot.model-propagation-contract")` e testes de fumaça cobrindo mismatch e caminho feliz; o objetivo de `TASK-BUD-521` permanece pendente de execução de research real até o contrato de propagação ficar validado end-to-end.

## Padrões Reaproveitáveis

| Padrão | Onde se aplica no agents-lab | Risco de adoção |
|--------|------------------------------|-----------------|
| Contrato de expectativa + leitura de `state.json` em runtime para validação de casta/modelo | `colony-pilot` (`tool_call` + `message_end`) | baixo |
| Registro de telemetria estruturada para inconsistência (`colony-pilot.model-propagation-contract`) | pipeline de observabilidade da extensão | baixo |
| Bloqueio por governança e evidência não conclusiva de pesquisa (failing with planner gaps) | `TASK-BUD-521` e execuções similares | médio |

## Riscos e Limites

- A pesquisa externa no repositório `mattpocock/sandcastle` não foi executada nesta rodada.
- O comportamento restante da orquestração depende da correção/validação do contrato entre `ant_colony` e executor em cenários com `workerModel`/`soldierModel` explícitos.
- Sem capacidade de relançar colônia nova por ora, há risco de assumir conclusões de referência sem execução real.

## Proposta de Próximos Passos

1. Manter a decisão de não relançar `TASK-BUD-521` em `ant_colony` até a validação do contrato de propagação ficar estável.
2. Após estabilização, rodar `ant_colony` em `deliveryMode: report-only` com `goal` e modelos explícitos para:
   - coletar fontes reais de `mattpocock/sandcastle`;
   - produzir síntese de padrões reutilizáveis e riscos locais;
   - registrar evidência completa conforme protocolo de delivery.
3. Atualizar `TASK-BUD-521-research.md` para `Status: completo` após a pesquisa e manter as evidências em `proof`/`delivery` no `deliveryPolicy`.
