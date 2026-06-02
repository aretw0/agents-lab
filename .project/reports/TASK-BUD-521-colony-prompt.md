# Prompt: TASK-BUD-521 — Colony Phase 1

Cole este prompt no Pi depois de recarregar/reiniciar a sessão para que o novo
`.pi/settings.json` seja lido.

```text
Use a skill colony-dogfood para conduzir somente a Fase 1 de TASK-BUD-521.

Antes de qualquer execução:
1. Rode o preflight/runtime health canônico para confirmar que a sessão pode continuar.
2. Confirme que as capabilities de colônia estão disponíveis: colony e colonyStop.
3. Se colony ou colonyStop estiverem ausentes, pare e reporte capability gap. Não faça research degradada nesta rodada.

Task:
- id: TASK-BUD-521
- description: Influência externa parked: avaliar futuramente `mattpocock/sandcastle` como referência de isolamento/sandboxing quando a trilha background->spawn estiver madura.
- objetivo da Fase 1: produzir `.project/reports/TASK-BUD-521-research.md` seguindo `.project/reports/_template-research.md`.

Envelope da colônia:
- usar ant_colony como executor real, não research manual degradada;
- maxCost: 2.0;
- scoutModel: openai-codex/gpt-5.3-codex-spark;
- workerModel: openai-codex/gpt-5.3-codex-spark;
- soldierModel: openai-codex/gpt-5.3-codex-spark;
- delivery/report mode: report-only;
- sem escrita de código;
- sem push;
- sem atualizar `.project/tasks.json`;
- sem criar ou editar `.project/reports/TASK-BUD-521-decision.md`.

Contrato de gate:
- O worker só pode criar/editar `.project/reports/TASK-BUD-521-research.md`.
- O arquivo `.project/reports/TASK-BUD-521-decision.md` é exclusivo do operador humano.
- Se você achar que a research justifica aprovação, escreva isso apenas como recomendação dentro da seção "Proposta de Próximos Passos" do research. Não marque approved em nenhum lugar.

Critério de saída:
- Responda com o status da colônia, budget usado, caminho do artefato, fontes consultadas e qualquer limitação.
- Se a colônia falhar por capability/package/preflight, não substitua por execução manual; reporte o blocker de ativação.
- Se os scouts retornarem saída vazia ou a queen falhar com `no_pending_worker_tasks`, pare e reporte falha de planejamento/modelo. Não faça loop de shell esperando arquivo.
```
