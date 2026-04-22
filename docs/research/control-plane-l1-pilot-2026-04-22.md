# Control-plane L1 pilot — 2026-04-22

## Escopo

Piloto L1 (control-plane only) executado em sessão contínua com foco em:
- autonomia pragmática sem perguntas óbvias;
- checkpoints/handoff sob `context-watch`;
- evidência canônica no board `.project`.

## Evidência de continuidade (sem interrupções de baixo risco)

Durante o lote, o fluxo manteve progressão contínua com commits atômicos e atualização canônica de verificação/tarefas, sem escalonamento humano para micro-escolhas reversíveis.

### Commits relevantes do piloto

- `9c5c6d6` — policy no-obvious-questions + auditoria de assunções (`guardrails-core.pragmatic-*`)
- `a46c45b` — readiness com recomendações acionáveis + rollout/rollback
- `f4028c1` — fechamento canônico TASK-BUD-085 + atualização milestone L1/L2

## Checkpoint/contexto

Snapshot operacional no final do lote:
- `context_watch_status`: `71%` (`checkpoint`), recomendação `write-checkpoint`
- handoff freshness: `fresh`

Interpretação: loop L1 manteve continuidade até checkpoint sem compact obrigatório, permitindo handoff curto e retomada determinística.

## Decisões automáticas assumidas (auditáveis)

Política aplicada no runtime:
- `guardrails-core.pragmatic-autonomy-policy`
- `guardrails-core.pragmatic-assumption-applied`

Semântica da assunção:
- ambiguidades de baixo risco são resolvidas por default seguro;
- mensagens não críticas durante long-run são deferidas para lane-queue sem interromper foco;
- escalonamento humano restrito a risco irreversível/perda de dados/conflito de objetivo.

## Gaps para promoção L1 -> L2

Leitura strict atual:
- `subagent_readiness_status(strict=true, source=isolated, days=1, limit=1)` => `ready=false`
- motivo bloqueante: `monitor-min-user-turns (1 vs >= 3)`

Sinais positivos já presentes:
- `COMPLETE=2`
- `FAILED=0`
- `BUDGET_EXCEEDED=0`
- pacotes de pilot strict presentes (`@ifi/oh-pi-ant-colony`, `@ifi/pi-web-remote`)

### Ação recomendada

1. executar janela controlada curta para elevar `userTurns` ao threshold;
2. rerodar gate strict com a mesma janela e registrar evidência canônica;
3. só então promover TASK-BUD-096 (L1->L2).

## Resultado do piloto L1

- Critério de continuidade: **atendido**
- Critério de assunções auditáveis: **atendido**
- Critério de gap report para L2: **atendido**
