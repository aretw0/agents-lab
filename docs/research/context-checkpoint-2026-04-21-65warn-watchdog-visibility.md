# Context checkpoint — 2026-04-21 (65% warn, watchdog visibility gap)

## Estado atual
- `context_watch_status`: `65%`, nível `warn` (`W50/C68/X72`).
- Recomendação ativa: micro-slices e evitar varredura ampla até checkpoint.

## Incidente observado
O aviso de watchdog apareceu na superfície de status (`[ctx] 52% warn · W50/C68/X72`) sem influenciar claramente a execução do control-plane no momento correto.

## Registro canônico aberto
- `DEC-BUD-034` (decidido): tratar sinais do watchdog como eventos operacionais explícitos e auditáveis no handoff.
- `TASK-BUD-081` (planned): tornar warn/checkpoint/compact operacionalmente visíveis no control-plane.
- `TASK-BUD-082` (planned): retenção determinística de artefatos de colônia em `failed/budget_exceeded` para evitar perda prática de worktree.

## Situação da colônia recente
- `c1` terminou em `budget_exceeded` com progresso parcial relevante.
- Worktree reportada no relatório não permaneceu disponível para inspeção posterior; retenção atual guarda metadados/excerpt, mas não garante snapshot reaplicável.

## Protocolo imediato até compactação
1. Manter micro-slices curtos.
2. Evitar buscas amplas/recursivas.
3. Em `>=68%`, checkpoint canônico curto imediato.
4. Em `>=72%`, compactar e retomar por handoff.
