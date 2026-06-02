# TASK-BUD-521 — Executor propagation gap

## Resultado
- **Classificação:** `executor propagation gap`
- **Escopo:** diagnóstico read-only após falha de planejamento da colônia.

## Evidência
- A chamada registrada em `.sandbox/pi-agent/sessions/--workspaces-agents-lab--/2026-06-02T02-15-01-945Z_019e861c-e839-75c0-a0dd-b35d425616e7.jsonl` contém `toolName: "ant_colony"` com:
  - `scoutModel: openai-codex/gpt-5.3-codex-spark`
  - `workerModel: openai-codex/gpt-5.3-codex-spark`
  - `soldierModel: openai-codex/gpt-5.3-codex-spark`
  - `deliveryMode: "report-only"`
- O state do executor em `.sandbox/pi-agent/ant-colony/root/workspaces/agents-lab/colonies/colony-mpw0epx0-scimi/state.json` não preserva esses campos:
  - `modelOverrides` ficou `{}`
  - ants persistidos aparecem apenas como `caste: "scout"` com `model: "github-copilot/gemini-3.1-pro-preview"`
  - não houve worker/soldier

## Conclusão
Os role model overrides chegaram à chamada `ant_colony`, mas não foram propagados para o estado/runtime do executor `@ifi/oh-pi-ant-colony`.

Não relançar os experimentos de research enquanto o contrato de propagação de `scoutModel`, `workerModel` e `soldierModel` não estiver validado.
