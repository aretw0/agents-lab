# CI Runner Adapter — Especificação

**Status:** draft  
**Data:** 2026-04-16  
**Relacionado:** TASK-BUD-015, TASK-BUD-017  
**Base:** [colony-project-task-bridge.md](../research/colony-project-task-bridge.md)

---

## Objetivo

Definir o contrato mínimo para sincronizar eventos do board canônico (`.project/tasks.json`) com runners externos (GitHub Actions, CI genérico) via issues/PRs, sem acoplar o runtime local a um provedor específico.

---

## Contrato de eventos canônico

Cinco eventos no ciclo de vida de uma task executada por agente:

| Evento | Trigger | Ação esperada no runner |
|--------|---------|------------------------|
| `start` | Task passa para `in-progress` | Abrir issue com título = task ID + descrição curta |
| `progress` | Nota adicionada à task (evidência parcial) | Comentar na issue com snapshot de progresso |
| `review` | Task candidata a fechamento (evidência completa, aguarda operador) | Abrir PR ou label `needs-review` na issue |
| `done` | Operador fecha task (`completed`) | Fechar issue/PR + registrar evidência no body |
| `recovery` | Task `blocked` ou evidence gap — promotion criada | Reabrir issue ou criar issue filha de recovery |

Estes eventos são **agnósticos de provider** — qualquer runner que consuma `.project/tasks.json` pode implementá-los.

---

## Mapeamento para GitHub Issues/PRs

| Estado da task | Estado equivalente no GitHub |
|---------------|------------------------------|
| `planned` | Issue não existe ainda |
| `in-progress` | Issue aberta, label `in-progress` |
| `in-progress` (candidato) | Issue aberta, label `needs-review` |
| `completed` | Issue fechada com label `done` |
| `blocked` | Issue aberta com label `blocked` |
| `deleted` | Issue fechada com label `cancelled` |

**Regras de mapeamento:**

- ID da task vira referência no título: `[TASK-BUD-017] scheduler autônomo`
- Body da issue inclui link para entrada no board (`/.project/tasks.json#L<linha>` ou snapshot)
- Labels são criados pelo runner se não existirem (`in-progress`, `needs-review`, `blocked`, `done`)

**Gaps e riscos conhecidos:**

| Gap | Impacto | Mitigação |
|----|---------|-----------|
| GitHub fecha issues ao mergar PR | Pode fechar task prematuramente | Usar label `needs-review` sem auto-close no PR |
| Board pode ser editado sem runner online | Divergência | Runner re-sync ao iniciar cada ciclo |
| Múltiplos runners no mesmo repo | Race condition em comentários | Single-writer: apenas um runner ativo por repo |

---

## Proposta de implementação incremental

### Fase 1 — Adapter local (sem GitHub)

Script que lê `.project/tasks.json` e produz um relatório de status em Markdown — sem chamadas externas. Serve como "dry-run" do que o runner publicaria.

```bash
node scripts/task-board-report.mjs --format=markdown
```

Saída esperada: lista de tasks abertas, candidatas e bloqueadas com evidência.

### Fase 2 — GitHub Issues sync (opt-in)

Extensão ou script que usa `gh` CLI para criar/atualizar issues com base no board. Ativado via flag explícita — nunca automático.

```bash
# sincronizar board -> issues (dry-run)
node scripts/task-board-report.mjs --sync=github --dry-run

# aplicar (requer gh auth)
node scripts/task-board-report.mjs --sync=github --apply
```

Configuração em `.project/ci.json`:

```json
{
  "github": {
    "repo": "aretw0/agents-lab",
    "syncEvents": ["start", "review", "done"],
    "labelPrefix": "pi:"
  }
}
```

### Fase 3 — GitHub Actions trigger (futuro)

Workflow que monitora push em `.project/tasks.json` e executa o sync automaticamente. Fora de escopo até Fase 2 estar validada.

---

## Limites de escopo

- Esta spec cobre apenas o **contrato** — não a implementação completa do sync.
- O board (`.project/tasks.json`) é sempre fonte de verdade; GitHub é uma projeção.
- Revisão do operador permanece obrigatória para fechamento de tasks estratégicas.
- Automação de fechamento via CI é explicitamente proibida sem override auditável.

---

## Referências

- [colony-project-task-bridge.md](../research/colony-project-task-bridge.md) — análise do gap atual
- [agent-driver-charter.md](./agent-driver-charter.md) — contrato de autonomia
- [swarm-cleanroom-protocol.md](./swarm-cleanroom-protocol.md) — protocolo de execução
