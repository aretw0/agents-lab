# Context checkpoint — 2026-04-21 (65% warn pre-compact)

## Observação rápida
- `context_watch_status`: percent=65, level=warn, thresholds W50/C68/X72.
- Sem bloqueio duro, mas já em faixa de preparação de compactação.

## Diagnóstico do "warn não apareceu"
- O watchdog publica status em `context-watch` e `ui.notify`; dependendo da superfície ativa, isso pode não aparecer como mensagem explícita no chat.
- O status tool confirma que o nível está correto (`warn`).

## Ação operacional
1. Manter micro-slices até 68%.
2. Em 68%: checkpoint curto obrigatório (`.project/handoff.json` + nota curta).
3. Em 72%: compactar e retomar por prompt de continuação.
4. Parar na segunda compactação para revisão humana.

## Patrol de compact-loop
- Scheduler workspace ativo: `p680rggu` (a cada 20m, 3 dias).
- Objetivo: emitir sinal explícito `[CTX_COMPACT_SIGNAL:COMPACT_REQUIRED]` quando nível `compact` e preparar continuação.
