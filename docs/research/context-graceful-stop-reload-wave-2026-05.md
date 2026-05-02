# Context Graceful-Stop + Reload Wave (2026-05)

## Objetivo
Calibrar o `context-watchdog` para priorizar **parada graciosa** antes de compactar, mantendo fallback determinístico e seguro quando atingir o limite final.

Resumo da meta:
- checkpoint = janela de fechamento gracioso;
- compact = gatilho final de compactação forçada;
- reload obrigatório = bloqueio fail-closed de auto-resume, com orientação antecipada.

## Problema observado
1. O aviso de contexto cheio pode interromper a sessão sem tempo de fechamento limpo.
2. Após compactação, quando há `reload-required`, o auto-resume é suprimido (correto), mas a experiência parece “travada” sem reforço antecipado suficiente.

## Boundary local-safe
- Sem auto-dispatch em escopo protected.
- Sem scheduler/remote/CI/offload automático.
- Sem alterar política de autorização (`authorization=none`).
- Mudanças focadas em primitives de sinalização, decisão e UX de continuidade.

## Estratégia em 2 estágios

### Estágio A — Graceful stop window (checkpoint)
- Em `checkpoint`, sinal explícito: fechar slice atual, persistir handoff e evitar iniciar novo bloco grande.
- Se `reloadRequired=true`, reforçar ação de operador **antes** do limite final (`/reload`).

### Estágio B — Force compact window (compact)
- Em `compact`, manter compactação automática como fallback final (quando elegível).
- Se auto-resume for suprimido por reload, preservar envelope/hint curto e determinístico para retomada manual.

## Sequência da wave
- `TASK-BUD-550` — Charter + contrato da wave.
- `TASK-BUD-551` — Primitive de estágio (graceful vs force) no context-watch.
- `TASK-BUD-552` — Gate reload-aware antecipado (pré-compact).
- `TASK-BUD-553` — Tool read-only de status de estágio de compactação.
- `TASK-BUD-554` — UX de suppression/handoff para `reload-required`.
- `TASK-BUD-555` — Regressão Copilot (60/65) + runbook final.

## Métricas de sucesso
1. **Graceful close rate**: mais checkpoints válidos antes de compact final.
2. **Reload clarity**: redução de sessões com “travamento percebido” pós-compact.
3. **Fail-closed invariants**: auto-resume continua bloqueado quando reload é obrigatório.
4. **Ruído controlado**: mensagens curtas, sem duplicação excessiva.

## Resultados da execução (TASK-BUD-550..555)
- `TASK-BUD-551`: primitive de estágio (`normal-window | graceful-stop-window | force-compact-window`).
- `TASK-BUD-552`: gate reload-aware pré-compact com sinal antecipado (`preCompactReloadSignal`) e hint consistente.
- `TASK-BUD-553`: tool `context_watch_compact_stage_status` (read-only, `authorization=none`, `dispatchAllowed=false`).
- `TASK-BUD-554`: preview `context_watch_auto_resume_preview` agora exibe `reload=required|clear` + hint curto no envelope.
- `TASK-BUD-555`: regressão smoke para calibração Copilot (checkpoint 60 e compact final derivado pelo clamp de segurança) + runbook final.

Observação de contrato: com `warn/error=45/65`, o compact efetivo fica limitado por política para `64` (`error-1`), preservando headroom antes da borda dura do provider.

## Rollback
- Reverter para comportamento anterior mantendo:
  - thresholds existentes (60/65),
  - suppression fail-closed já vigente,
  - sem perda de contratos de tool/read-only.
