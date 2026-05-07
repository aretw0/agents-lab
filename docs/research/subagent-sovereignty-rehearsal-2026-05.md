# Subagent sovereignty rehearsal — 2026-05

## Steering

Direção humana: priorizar a base dos subagentes para descarregar o control plane, começando pelo menor degrau governado e maturando até workers múltiplos/background/colônia guiada. Não fechar tasks de UI/TUI/WEB que ainda não estejam prontas; elas podem virar material para agentes revisarem depois.

## Estado dos gates

- `subagent_readiness_status(strict)`: READY com evidência COMPLETE e sem FAILED/BUDGET_EXCEEDED/classify failures na janela.
- `agent_spawn_readiness_gate`: ready-for-agent-run para 1 worker, timeout bounded, cwd/budget/rollback/scope conhecidos.
- `delegation_readiness_status_packet`: ainda recomenda local-execute-first; blockers principais são telemetria/focus/auto-advance insuficientes, não incapacidade básica de spawn.

## Escada de maturidade proposta

1. **Rehearsal report-only**: produzir pacote completo de uma run, dry-first registry e critérios de outcome, sem dispatch.
2. **Um worker real**: somente após confirmação humana explícita para uma run específica; registrar `run_id`, cwd, declared files, log path, timeout e budget antes do start.
3. **Outcome parent-side**: separar `processState` de `contractDecision`; validar arquivos declarados e markers antes de aceitar resultado.
4. **Repetição controlada**: 2–3 runs limpas antes de considerar múltiplos workers.
5. **Background/colônia guiada**: só depois de status/log/abort/outcome estarem confiáveis sob pressão real.

## Primeiro candidato de rehearsal

Usar a fatia de UI quota já em andamento como material de revisão para um worker, porque é local-safe e não bloqueia arquitetura crítica:

- `run_id`: `task-bud-986-quota-ui-review-rehearsal`
- objetivo: revisar o patch de legenda TUI/footer/panel de `TASK-BUD-968` e produzir nota bounded; não editar sem escalonamento do control plane.
- provider/model planejado: `openai-codex/gpt-5.3-codex-spark`
- timeout: `90000ms`
- declared files:
  - `docs/research/quota-panel-footer-legend-2026-05.md`
  - `packages/pi-stack/extensions/quota-visibility-model.ts`
  - `packages/pi-stack/extensions/quota-panel.ts`
  - `packages/pi-stack/extensions/custom-footer.ts`
  - `packages/pi-stack/test/smoke/quota-visibility-parsers.test.ts`
  - `packages/pi-stack/test/smoke/quota-panel.test.ts`
  - `packages/pi-stack/test/smoke/custom-footer-registration.test.ts`

## Regras de execução

- Este documento e o packet `agent_run_plan` **não autorizam dispatch**.
- Antes de qualquer worker real, exigir frase humana explícita do tipo: `execute o worker task-bud-986-quota-ui-review-rehearsal`.
- Se executar, fazer registry upsert aplicado antes do start e manter `agent_run_status`, `agent_run_log_tail`, `agent_run_abort` e `agent_run_outcome_packet` como superfícies obrigatórias.
- Se o worker tocar arquivo fora de `declared_files`, o outcome deve falhar e recomendar rollback dos arquivos inesperados.

## Validação local atual

- `npx vitest run packages/pi-stack/test/smoke/quota-visibility-parsers.test.ts packages/pi-stack/test/smoke/quota-panel.test.ts packages/pi-stack/test/smoke/custom-footer-registration.test.ts` → 100 passed.
