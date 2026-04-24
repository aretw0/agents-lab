# TASK-BUD-146 — Context steering signal invariant (modo-independente)

Data: 2026-04-24  
Status: design slice (sem mudança de runtime neste passo)

## Problema
Hoje o operador pode perceber sinal de contexto de forma inconsistente (UI/tool/audit), o que cria risco de continuidade cega quando o contexto já está alto.

## Objetivo
Garantir um **contrato mínimo de delivery** para sinais de contexto (`warn`, `checkpoint`, `compact`) que funcione em qualquer modo (traditional/factory/report-only), sem depender de tool manual.

## Invariante proposta
1. **Canal passivo obrigatório**: toda transição de nível publica steering curto e acionável.
2. **Modo-independente**: mesma semântica para `warn/checkpoint/compact` em todos os modos.
3. **Fallback determinístico**: se superfície principal não estiver visível, emitir via canal textual/audit alternativo.
4. **Anti-ruído**: cooldown por razão para não floodar; repetir apenas quando nível/recomendação mudar.

## Payload canônico mínimo
- `level`: `ok|warn|checkpoint|compact`
- `percent`: número inteiro
- `thresholds`: `{ warnPct, checkpointPct, compactPct }`
- `recommendation`: texto curto
- `action`: `none|micro-slice-only|write-checkpoint|compact-now`
- `delivery`: `passive|fallback`
- `reason`: ex.: `threshold-crossed`, `level-changed`, `manual-status-request`

## Regras operacionais
- `warn`: orientar micro-slice e evitar scans amplos.
- `checkpoint`: pedir checkpoint/handoff antes de próxima fatia grande.
- `compact`: bloquear expansão e orientar compact/resume imediato.
- Sempre incluir **próximo passo explícito** (1 linha).

## Critério de aceitação (fase runtime)
- Sinal aparece sem chamada manual de tool quando nível muda.
- Mesmo conteúdo-base disponível em `/context-watch` e no canal passivo.
- Teste smoke cobre transição `warn -> checkpoint -> compact` com expectativa de delivery e cooldown.
