# TASK-BUD-521 — Falha de planejamento (colônia c1)

## Resultado final
- **Status:** `planning failure`
- **Decisão:** Não marcado como concluído.

## Evidência da falha
- Sinal final recebido:
  - `[COLONY_SIGNAL:FAILED] 🐜[c1|colony-mpw0epx0-scimi] No valid execution plan after 2 recovery rounds. Issues: no_pending_worker_tasks.`
- A chamada `ant_colony` foi feita com role models explícitos:
  - `scoutModel: openai-codex/gpt-5.3-codex-spark`
  - `workerModel: openai-codex/gpt-5.3-codex-spark`
  - `soldierModel: openai-codex/gpt-5.3-codex-spark`
- O report final da colônia ainda mostrou routing apenas para scout em:
  - `github-copilot/gemini-3.1-pro-preview`
- Em todas as validações de artifacts/estado até o fechamento, **não houve** geração de:
  - `.project/reports/TASK-BUD-521-research.md`
- Motivo técnico: ausência de tarefas válidas pendentes para worker após tentativas de planejamento/recuperação.

## Observação de conformidade do teste
- Critério do operador: falha por `no_pending_worker_tasks` deve ser reportada como **planning failure**.
- Atendeu: **sim**.

## Próximo passo recomendado
- Não relançar `ant_colony` para este experimento até investigar por que o executor ignorou ou não propagou os role model overrides explícitos.
- Próxima fatia recomendada: corrigir/validar o contrato entre `colony-pilot` e `@ifi/oh-pi-ant-colony` para que `scoutModel`, `workerModel` e `soldierModel` apareçam no estado/runtime da colônia antes de executar research real.
