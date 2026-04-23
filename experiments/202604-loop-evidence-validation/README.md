# 202604-loop-evidence-validation

**Data:** 2026-04-23  
**Engine:** Pi (guardrails-core / lane-queue)  
**Status:** Em andamento

## Objetivo

Validar de forma determinística quando o loop board-first está realmente liberado para long-run (`TASK-BUD-125`), sem depender de varredura frágil de JSONL.

Critério de fechamento operacional:
- `boardAuto.runtimeCodeState=active`
- `boardAuto.emLoop=yes`
- `loopReady.runtimeCodeState=active`

## Hipótese

Se o runtime persistir evidência mínima em arquivo canônico (`.pi/guardrails-loop-evidence.json`) e houver um checker CLI com gate de frescor, então o operador consegue provar estado de loop em segundos, com baixo custo de contexto.

## Setup

1. Gerar/observar evento de loop no runtime (`/lane-queue status` + auto-advance).
2. Inspecionar snapshot rápido:
   - `/lane-queue evidence`
3. Executar gate externo:
   - `npm run ops:loop-evidence:check`
   - `npm run ops:loop-evidence:strict`

## Resultados parciais

- Persistência local de evidência já existe em `guardrails-core`:
  - `lastLoopReady`
  - `lastBoardAutoAdvance`
- Checker externo adicionado:
  - `scripts/guardrails-loop-evidence-check.mjs`
  - status `missing|invalid-json|stale|ok`
  - `readyForTaskBud125=yes|no`
  - critérios explícitos por campo
- Cobertura adicionada em `scripts/test/guardrails-loop-evidence-check.test.mjs`.

## Decisão provisória

**Iterar** até capturar evidência real `readyForTaskBud125=yes` em runtime ativo; depois promover como playbook padrão para fechamento de long-run readiness.
