# Context Checkpoint — 2026-04-19 (Spark-aware routing / TASK-BUD-053)

## Objetivo
Aplicar política Spark-aware após fechamento da c6, mantendo operação unattended:
- priorizar cota normal por padrão;
- liberar `gpt-5.3-codex-spark` apenas com gatilhos explícitos (`planning recovery`, `scout burst`);
- registrar evidência no board/docs sem interromper lotes correntes.

## Resultado consolidado no main
- `colony-pilot` recebeu gate explícito para uso de modelos `codex-spark` por trigger semântico no goal.
- `.pi/settings.json` passou a ativar `sparkGateEnabled` com triggers explícitos.
- Documentação operacional atualizada com seção dedicada de governança Spark.
- Plano unattended atualizado com diretriz Spark-aware no checklist.

## Decisão operacional
- **Default continua em cota normal** (`gpt-5.3-codex` etc.).
- **Spark só por gatilho explícito no goal**:
  - `planning recovery` (libera uso amplo em múltiplos papéis)
  - `scout burst` (restrito a papel scout)
- Sem gatilho explícito, uso de `*-spark` deve ser bloqueado por policy.

## File Inventory
- `.pi/settings.json`
- `packages/pi-stack/extensions/colony-pilot.ts`
- `docs/guides/colony-provider-model-governance.md`
- `docs/guides/unattended-swarm-execution-plan.md`
- `.project/tasks.json`
- `HANDOFF.md`
- `docs/research/context-checkpoint-2026-04-19-spark-aware-routing.md`

## Validation Command Log
1. `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" scripts/verify-pi-stack.mjs`
   - **PASS** — `pi-stack ok — 10 verificações passaram`.
2. `grep -n "sparkGateEnabled\|sparkAllowedGoalTriggers\|sparkScoutOnlyTrigger" .pi/settings.json packages/pi-stack/extensions/colony-pilot.ts docs/guides/colony-provider-model-governance.md`
   - **PASS** — chaves/configurações Spark-aware detectadas em settings, runtime e guia.

## Observações
- Mantido HITL: sem auto-close de P0.
- Sem release/publish.
- Sem alteração em `CLAUDE.md`.
