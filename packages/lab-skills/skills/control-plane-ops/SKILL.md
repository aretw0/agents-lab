---
name: control-plane-ops
description: >
  Operar o control-plane local-first do agents-lab com board canônico, long-runs bounded,
  handoff/checkpoint, rollout/rollback e espelhos externos sem perder governança.
---

# Control-plane ops skill

Use esta skill quando a tarefa envolver long-runs, board-first, continuidade, handoff, delegação/subagentes, swarm/colony, mirrors externos ou rollout/rollback operacional.

## Prioridade operacional

1. **Board canônico primeiro**: `.project/tasks.json` + `.project/verification.json` são fonte local de verdade.
2. **Slice bounded**: selecione uma task, faça mudança pequena, valide gate focal, commite, atualize board.
3. **Handoff antes de risco de contexto**: em checkpoint, refresque `.project/handoff.json`; em compact, pare novo trabalho e deixe auto-resume continuar.
4. **Escala progressiva**: L1 control-plane direto por default; L2 subagente só com readiness; L3 swarm só com preflight/budget/escopo paralelo.
5. **Sem auto-close externo**: GitHub/Gitea/trackers espelham o board; completion local requer verificação local.

## Mapa guide -> skill/playbook

| Conteúdo crítico | Guia canônico | Aplicação nesta skill |
|---|---|---|
| Loop local-first/board-first | `docs/guides/project-canonical-pipeline.md` | escolher task, validar, commit, atualizar board |
| Evolução L1/L2/L3 | `docs/guides/control-plane-evolution-playbook.md` | decidir quando manter simples, delegar ou usar swarm |
| Checkpoint/compact/handoff | `docs/guides/project-canonical-pipeline.md` | refrescar handoff no checkpoint e parar novo trabalho no compact |
| Rollout/rollback de delegação | `docs/guides/control-plane-evolution-playbook.md` | canário curto, evidência no parent, rollback para L1 |
| Mirror GitHub/Gitea | `packages/git-skills/skills/github/SKILL.md` | tratar issue externa como referência, não autoridade |
| Higiene e drift de board | `docs/guides/project-canonical-pipeline.md` | single writer, lock+atomic, generated apply step |

## Checklist de execução bounded

```text
1. context_watch_status + machine_maintenance_status + quota_alerts
2. autonomy_lane_status (ou board_query) para selecionar task
3. ler só arquivos-alvo
4. editar/implementar micro-slice
5. rodar teste focal
6. git diff --check
7. commit apenas arquivos intencionais
8. atualizar task + verification com rationale quando sensível
9. repetir ou checkpoint conforme contexto
```

## Política structured/board-first

- Para `.project/tasks.json`: preferir `board_query`/`board_update`.
- Para `.project/verification.json`: preferir `board_query`, `read-block`/`write-block` ou `structured_io`.
- Para artefatos estruturados grandes: usar `structured_io`, `safe_mutate_large_file` ou macro-API apropriada antes de `edit` textual amplo.

## Escala e rollback

Sugira L2/L3 apenas com motivo objetivo:

- contexto: janela alta ou tarefa extensa;
- backlog: itens paralelizáveis e independentes;
- readiness: `subagent_readiness_status(strict=true)` verde;
- custo: quota/provider sem WARN/BLOCK e budget explícito.

Fallback obrigatório: “voltar para L1/control-plane direto” preservando commits, board e handoff já validados.
