# TASK-BUD-060 — Monitor classify stability (2026-04-20)

## Context

Falha recorrente em runtime de monitors (OpenAI-only / `openai-codex`) com erro:

```text
No tool call in response (...) error: {"detail":"Instructions are required"}
```

## Causa raiz

`openai-codex` (Responses API) exige `instructions` no payload. No classify path dos monitors, esse campo é preenchido a partir de `context.systemPrompt`. Os overrides `.pi/agents/*.agent.yaml` dos classifiers tinham apenas `prompt.task` (sem `prompt.system`), então o classify podia falhar sem tool call.

## Mitigação aplicada

1. **Patch productizado em `monitor-provider-patch`**
   - `packages/pi-stack/extensions/monitor-provider-patch.ts`
   - `generateAgentYaml(...)` agora inclui `prompt.system` canônico para todos os 5 classifiers.
   - Novo reparo automático: `repairMissingSystemPromptOverrides(cwd)` para corrigir overrides legados já existentes.
   - `session_start` agora roda esse reparo e reporta quando aplicável.

2. **Overrides locais corrigidos**
   - `.pi/agents/commit-hygiene-classifier.agent.yaml`
   - `.pi/agents/fragility-classifier.agent.yaml`
   - `.pi/agents/hedge-classifier.agent.yaml`
   - `.pi/agents/unauthorized-action-classifier.agent.yaml`
   - `.pi/agents/work-quality-classifier.agent.yaml`

3. **Documentação / gate de release**
   - `docs/guides/monitor-overrides.md`
   - `packages/pi-stack/README.md`
   - Regra explícita: bloquear publish com novo `classify failed` durante smoke de monitores.

## Evidência de validação

- Teste direcionado:
  - `node --test packages/pi-stack/test/monitor-provider-patch.test.mjs`
  - Resultado: **25/25 pass** (inclui novo teste de reparo `prompt.system`).

- Verificação stack:
  - `npm run verify`
  - Resultado: **10 checks pass**.

- Smoke controlado com monitores habilitados:
  - `monitors-control on`
  - 3 ciclos de classify via monitor `unauthorized-action` (tool_call path) com reset entre ciclos.
  - `monitors_compact_status` permaneceu em `classifyFail=16` (sem incremento após os ciclos).

## Observação operacional

`monitors_compact_status` agrega histórico de falhas do arquivo de sessão (não zera automaticamente). Para gate de release, considerar **novas** falhas durante o smoke atual; não contadores antigos.
