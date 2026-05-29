---
title: "Colony Self-Use"
description: Como usar a colônia Pi nativa para conduzir experimentos de research e código com governança explícita — o pipeline que o agents-lab usa para evoluir a si mesmo.
---

# Colony Self-Use

O agents-lab usa sua própria colônia Pi para evoluir. Esta página documenta
o pipeline de dogfood progressivo executado antes da release v0.8.0 e mostra
como reproduzir o mesmo fluxo na sua instalação.

## O que foi feito

Durante o ciclo pré-v0.8.0, a colônia executou experimentos de research
a partir de `.project/tasks.json`, produzindo sínteses que alimentam
decisões de código subsequentes. Os artefatos ficam em `.project/reports/`
e as melhores sínteses são promovidas para `docs/research/`.

## Como reproduzir

### Pré-requisitos

- `@aretw0/pi-stack` instalado (`npx @aretw0/pi-stack`)
- `pnpm run pi:runtime:health` retornando `decision=continue`
- Colônia ativa no seu `.pi/settings.json` (remover `!extensions/colony-pilot.ts` se presente)

### Estrutura de um experimento

Cada experimento segue três fases com gates humanos obrigatórios:

```
task selecionada do board
    ↓
colony worker — Fase 1: research (maxCost: $2)
    ↓
.project/reports/TASK-ID-research.md
    ↓  gate humano: operador revisa e preenche decision.md
.project/reports/TASK-ID-decision.md (approved: true/false)
    ↓  se aprovado e Fase 2 autorizada
colony worker — Fase 2a: impl-plan (maxCost: $1)
    ↓  gate humano: operador aprova plano
colony worker — Fase 2b: código (maxCost: $5)
    ↓  gate de smoke (pnpm run ci:local:parity) + gate humano
merge
```

### Usando o skill colony-dogfood

O skill `colony-dogfood` do `@aretw0/lab-skills` guia o Pi por todo o
protocolo. No Pi TUI, basta invocar o skill para a task desejada.

Os templates de artefato ficam em `.project/reports/`:

- `_template-research.md` — formato de síntese de research
- `_template-decision.md` — formato do gate humano de decisão
- `_template-impl-plan.md` — formato da proposta de implementação

### Budget de referência

| Fase | maxCost sugerido | Finalidade |
|------|-----------------|------------|
| Research | $2.00 | Leitura externa + síntese |
| Impl-plan | $1.00 | Proposta de documento |
| Implementação | $5.00 | Código + commit |

## Governança

Nenhum worker tem permissão de push direto. Todo código produzido fica em
branch local até o operador revisar o diff e aprovar o merge. O budget
envelope é explícito por experimento — não há execução de colônia sem
`maxCost` definido.

O `hardCapUsd` configurado em `.pi/settings.json` protege contra runaway.
Evidência de cada execução fica em `.project/reports/` e pode ser auditada
ou contestada a qualquer momento.

## Promoção de evidência

Após completar um experimento, promova o melhor artefato para `docs/research/`:

```bash
cp .project/reports/TASK-ID-research.md docs/research/TASK-ID-synthesis.md
```

Adicione frontmatter Jekyll no topo do arquivo copiado:

```markdown
---
title: "Síntese: [nome da task]"
date: YYYY-MM-DD
evidence_type: colony-dogfood-experiment
task: TASK-ID
---
```
