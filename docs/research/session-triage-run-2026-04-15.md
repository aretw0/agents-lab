---
created: 2026-04-15
status: draft
---

# Session triage + tidy up (run 2026-04-15)

## Contexto

Objetivo do run: organizar pendências a partir das sessões recentes, limpar resíduos de worktrees/runtime e separar backlog em trilhas de execução imediata vs estabilização.

## Ações executadas

### 1) Tidy up de worktrees/runtime

Pré-condição validada:
- `/colony-pilot status` sem colônias ativas

Limpeza aplicada:
- removidos worktrees antigos `sync-*` sob `~/.pi/agent/ant-colony/.../worktrees/`
- branches locais removidas:
  - `ant-colony/sync-mnxhuviz-mnxhuvkw-ddasa`
  - `ant-colony/sync-mnxhwwla-mnxhwwnm-azpyg`
  - `ant-colony/sync-mnxi5fnj-mnxi5fpd-egryz`
- removido estado órfão de colônia antiga:
  - `colony-mnxi5ftw-dg1ke` (ficou sem worktree associado)

Resultado:
- `git worktree list` voltou para apenas o worktree principal
- `/colony-pilot artifacts` sem colônias/worktrees residuais

### 2) Pipeline hard para triagem de histórico recente

Adicionado script:
- `scripts/session-triage.mjs`

Comandos adicionados:
- `npm run session:triage`
- `npm run session:triage:json`

Cobertura do script:
- sessões recentes (default: 1 dia)
- sinais `COLONY_SIGNAL:*`
- agregação de branch summaries (quando disponíveis no histórico)
- split do board em:
  - **Unlock swarm now**
  - **Later stabilization**

### 3) Pipeline soft (skill + guia)

Skill:
- `packages/lab-skills/skills/session-triage/SKILL.md`

Guia:
- `docs/guides/session-triage.md`

Índices atualizados:
- `packages/lab-skills/README.md`
- `docs/guides/README.md`

### 4) Board canônico atualizado

Tasks adicionadas:
- `TASK-BUD-020` — pipeline de triagem de histórico recente
- `TASK-BUD-021` — control plane portátil (handoff/resume entre instâncias)
- `TASK-BUD-022` — captura estruturada de branch-summary para triagem automática

## Snapshot operacional (após run)

- Board válido (`project-validate` = clean)
- `verify` do workspace passou (10/10)
- Pendências críticas continuam concentradas em:
  - promotions `colony-c1..c4-promotion`
  - hardening P0 de delivery/governança ainda em fluxo de promoção/materialização

## Riscos residuais

1. Delivery `patch-artifact` continua exigindo promoção explícita para materializar código no `main`.
2. Parte dos branch summaries pode não estar persistida no JSONL (lacuna de observabilidade já registrada em `TASK-BUD-022`).
3. Sem apply-to-branch por padrão, risco de acumular candidate-only permanece (mitigado por auto-queue de promotion).

## Próximo passo recomendado

1. Rodar `npm run session:triage` no início de cada ciclo.
2. Priorizar promotions pendentes (`colony-c1..c4-promotion`) antes de abrir novas frentes de código.
3. Evoluir `TASK-BUD-021` para permitir restart seguro do cliente (`pi --resume`) com supervisão contínua.
