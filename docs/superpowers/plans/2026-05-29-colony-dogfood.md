# Colony Dogfood Progressivo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ativar e executar o pipeline de auto-uso onde o agents-lab usa sua própria colônia Pi nativa para conduzir experimentos de research e código a partir de `.project/tasks.json`, produzindo evidência interna e guia externo antes da release v0.8.0.

**Architecture:** Pi control-plane coordena; colony workers executam tarefas em dois tempos (research → código) separados por gates humanos explícitos; artefatos em `.project/reports/` são promovidos para `docs/` como prova externa. O perfil de laboratório ativa a colônia somente para este ciclo de experimentos — sem alterar o default de usuário (`strict-curated`).

**Tech Stack:** Pi runtime, `colony-pilot.ts` / `colony-panel.ts`, `.project/tasks.json` + `decisions.json`, `lab-skills` skill package.

**Spec:** `docs/superpowers/specs/2026-05-29-colony-dogfood-design.md`

---

## Task 1: Ativar colony-pilot no perfil de laboratório

**Files:**
- Modify: `.pi/settings.json` (remover exclusões de colony-pilot e colony-panel)

O colony-pilot está desligado por opt-out explícito (`!extensions/colony-pilot.ts`). A ativação é remover as duas linhas de exclusão — a infraestrutura e budget já estão configurados (`defaultMaxCostUsd: 0.5`, `hardCapUsd: 60`, `requireMaxCost: true`).

- [ ] **Remover exclusões de colony no settings**

Em `.pi/settings.json`, dentro do array `extensions` do pacote `../packages/pi-stack`, remover as duas linhas:

```json
"!extensions/colony-pilot.ts",
"!extensions/colony-panel.ts",
```

O bloco de exclusões após a edição deve continuar com as demais linhas intactas (guardrails, web-session-gateway, quota-panel, etc.).

- [ ] **Verificar que o Pi carrega a extensão**

```bash
pnpm run pi:runtime:health
```

Esperado: `decision=continue` e sem erros de carregamento de extensão. Se aparecer `colony-pilot` nos warnings de extensão faltante, significa que a remoção foi incompleta.

- [ ] **Commit**

```bash
git add .pi/settings.json
git commit -m "feat(lab): ativar colony-pilot para experimentos dogfood"
```

---

## Task 2: Criar templates de artefatos de research e decisão

**Files:**
- Create: `.project/reports/_template-research.md`
- Create: `.project/reports/_template-decision.md`
- Create: `.project/reports/_template-impl-plan.md`

Os templates definem o contrato de output que o colony worker deve seguir. Não são gerados por código — são arquivos editáveis com seções obrigatórias. O worker preenche uma cópia renomeada para o ID da task.

- [ ] **Criar template de research**

Criar `.project/reports/_template-research.md`:

```markdown
# Research: [TASK-ID] — [Nome da Task]

**Executor:** colony-worker
**Data:** YYYY-MM-DD
**Budget usado:** $X.XX de $Y.YY
**Status:** completo | parcial (motivo: budget atingido | contexto insuficiente)

## Objetivo

[Reproduzir a description da task aqui]

## Fontes Consultadas

- [URL ou path lido]
- [URL ou path lido]

## Síntese

[2-4 parágrafos com os padrões encontrados, filtrando pelo que é aplicável ao contexto local-first do agents-lab]

## Padrões Reaproveitáveis

| Padrão | Onde se aplica no agents-lab | Risco de adoção |
|--------|------------------------------|-----------------|
| ...    | ...                          | baixo/médio/alto |

## Riscos e Limites

[O que NÃO foi coberto, o que pode ter mudado no repo externo desde a análise]

## Proposta de Próximos Passos

[Nenhum | Experimento bounded descrito aqui | Promoção para docs/research/]
```

- [ ] **Criar template de decision (gate humano)**

Criar `.project/reports/_template-decision.md`:

```markdown
# Decision: [TASK-ID] — Gate Humano

**Data da revisão:** YYYY-MM-DD
**Revisado por:** operador

## Resumo do Artefato de Research

[2-3 linhas resumindo o que o worker produziu]

## Decisão

approved: true | false

## Justificativa

[Por que aprovado ou rejeitado]

## Fase 2 autorizada?

sim | não

[Se sim: qual próximo passo de código está autorizado]
[Se não: a task volta para planned com a nota abaixo]

## Nota de retorno (se rejeitado)

[Contexto para o próximo worker ou sessão humana]
```

- [ ] **Criar template de impl-plan (Fase 2)**

Criar `.project/reports/_template-impl-plan.md`:

```markdown
# Impl Plan: [TASK-ID] — Proposta do Worker

**Executor:** colony-worker
**Data:** YYYY-MM-DD
**Baseado em:** .project/reports/[TASK-ID]-research.md

## Escopo da Implementação

[O que exatamente este plano propõe mudar — arquivos, contratos, docs]

## Arquivos a Criar ou Modificar

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| ...     | criar/modificar | ... |

## Sequência de Passos

1. [Passo concreto]
2. [Passo concreto]

## Smoke Gate

```bash
[comando de verificação]
```

Esperado: [output]

## Rollback

[Como desfazer se algo der errado — git reset, arquivo a deletar, etc.]
```

- [ ] **Commit**

```bash
git add .project/reports/_template-research.md \
        .project/reports/_template-decision.md \
        .project/reports/_template-impl-plan.md
git commit -m "docs(reports): adicionar templates de artefato para experimentos colony"
```

---

## Task 3: Criar skill colony-dogfood em lab-skills

**Files:**
- Create: `packages/lab-skills/skills/colony-dogfood/SKILL.md`

Este skill é lido pelo Pi (e pelo colony worker) para saber como conduzir um experimento de dogfood. Segue o mesmo formato SKILL.md já usado em `session-triage`, `cultivate-primitive`, etc.

- [ ] **Criar diretório e skill**

Criar `packages/lab-skills/skills/colony-dogfood/SKILL.md`:

```markdown
---
name: colony-dogfood
description: >
  Conduz um experimento de dogfood onde a colônia Pi executa uma task do
  .project/tasks.json em dois tempos (research → código) com gates humanos.
  Use quando o operador quiser ativar um experimento colony-experiment-phase1
  ou colony-experiment-phase2.
---

# Colony Dogfood

Este skill guia a execução de um experimento de auto-uso onde o agents-lab
usa sua própria colônia para evoluir. Siga os passos na ordem — nunca pule
um gate humano.

## Pré-condições

Antes de iniciar qualquer experimento:

```bash
pnpm run pi:runtime:health
```

Esperado: `decision=continue`. Se retornar `decision=stop`, investigue o
watchdog antes de continuar.

## Fase 1: Research

### 1. Selecionar a task

Escolha uma task com `milestone: "colony-experiment-phase1"` e `status: "in_progress"`.
Leia a `description` e os `acceptance_criteria`.

### 2. Abrir execution envelope

No Pi, use `ant_colony` com:

- `goal`: reproduzir a `description` da task + "Produzir síntese em .project/reports/TASK-ID-research.md seguindo o template _template-research.md"
- `maxCost`: 2.0 (USD) — suficiente para leitura de repo externo + síntese
- Worker model: modelo econômico (ex: flash/mini) — research não requer o modelo mais caro
- Sem permissão de escrita de código ou push

### 3. Output esperado do worker

O worker deve criar `.project/reports/TASK-ID-research.md` preenchendo todos
os campos do template. Se o budget for atingido antes da síntese estar
completa, o worker deve marcar `status: parcial` e salvar o que conseguiu.

### 4. Gate humano (obrigatório)

Leia `.project/reports/TASK-ID-research.md`.
Preencha `.project/reports/TASK-ID-decision.md` a partir do template.
Marque `approved: true` ou `approved: false`.

Só avance para Fase 2 se `approved: true` E `Fase 2 autorizada?: sim`.

## Fase 2: Código

### 1. Proposta de impl-plan

Com o gate aprovado, abra um segundo envelope colony:

- `goal`: "Ler .project/reports/TASK-ID-research.md e .project/reports/TASK-ID-decision.md. Propor plano de implementação em .project/reports/TASK-ID-impl-plan.md seguindo o template. NÃO implementar — apenas propor."
- `maxCost`: 1.0 (USD) — apenas leitura e escrita de documento

### 2. Gate humano (obrigatório)

Leia `.project/reports/TASK-ID-impl-plan.md`.
Aprove o plano ou peça revisão antes de avançar.

### 3. Implementação

Com o plano aprovado:

- `goal`: "Implementar o plano em .project/reports/TASK-ID-impl-plan.md. Produzir branch + commit + entrada de changeset. NÃO fazer push — apenas commit local."
- `maxCost`: 5.0 (USD)

### 4. Gate de verificação

Execute o smoke da task antes de revisar o diff:

```bash
pnpm run ci:local:parity
```

### 5. Gate humano final

Revise o diff. Se aprovado, faça o merge. Atualize `tasks.json`:
`status: "completed"`.

## Promoção de Evidência

Após completar ≥1 experimento, promova o melhor artefato:

```bash
cp .project/reports/TASK-ID-research.md docs/research/TASK-ID-synthesis.md
```

Adicione frontmatter:

```markdown
---
title: Síntese: [nome da task]
date: YYYY-MM-DD
evidence_type: colony-dogfood-experiment
task: TASK-ID
---
```

## Budget de Referência

| Fase | maxCost sugerido | Finalidade |
|------|-----------------|------------|
| Research | $2.00 | Leitura externa + síntese |
| Impl-plan | $1.00 | Proposta de documento |
| Implementação | $5.00 | Código + commit |
```

- [ ] **Verificar que o skill é detectado pelo lab-skills package**

```bash
pnpm run docs:package:check
```

Esperado: sem erros de skill não registrado. Se o package exige registro explícito, adicione a entrada no `package.json` de `lab-skills`.

- [ ] **Commit**

```bash
git add packages/lab-skills/skills/colony-dogfood/SKILL.md
git commit -m "feat(lab-skills): adicionar skill colony-dogfood para experimentos de auto-uso"
```

---

## Task 4: Promover as 3 tasks P3 para colony-experiment-phase1

**Files:**
- Modify: `.project/tasks.json`
- Modify: `.project/decisions.json`

A promoção é uma decisão explícita do operador. Cada task muda de `milestone: "protected-parked-legacy"` para `milestone: "colony-experiment-phase1"` e `status: "in_progress"`.

- [ ] **Atualizar TASK-BUD-676 em tasks.json**

Localizar o objeto com `"id": "TASK-BUD-676"` e atualizar:

```json
{
  "id": "TASK-BUD-676",
  "status": "in_progress",
  "milestone": "colony-experiment-phase1",
  "notes": "[existente]\n2026-05-29: promovida para colony-experiment-phase1 por decisão DEC-BUD-XXX. Primeiro experimento do pipeline de dogfood progressivo."
}
```

- [ ] **Atualizar TASK-BUD-521 em tasks.json**

Localizar o objeto com `"id": "TASK-BUD-521"` e atualizar:

```json
{
  "id": "TASK-BUD-521",
  "status": "in_progress",
  "milestone": "colony-experiment-phase1",
  "notes": "[existente]\n2026-05-29: promovida para colony-experiment-phase1 por decisão DEC-BUD-XXX. Segundo experimento do pipeline de dogfood progressivo."
}
```

- [ ] **Atualizar TASK-BUD-480 em tasks.json**

Localizar o objeto com `"id": "TASK-BUD-480"` e atualizar:

```json
{
  "id": "TASK-BUD-480",
  "status": "in_progress",
  "milestone": "colony-experiment-phase1",
  "notes": "[existente]\n2026-05-29: promovida para colony-experiment-phase1 por decisão DEC-BUD-XXX. Terceiro experimento do pipeline de dogfood progressivo."
}
```

- [ ] **Registrar decisão de promoção em decisions.json**

Adicionar ao array `"decisions"`:

```json
{
  "id": "DEC-BUD-XXX",
  "decision": "Promover TASK-BUD-676, TASK-BUD-521 e TASK-BUD-480 de protected-parked-legacy para colony-experiment-phase1 como primeiros experimentos do pipeline de dogfood progressivo.",
  "rationale": "O factory está estável e o scheduler está intencionalmente vazio. Usar a colônia nativa Pi para executar as tasks P3 de research prova o valor da stack antes da release v0.8.0, gerando evidência interna (.project/reports/) e externa (docs/guides/colony-self-use.md). Evolução de DEC-BUD-005.",
  "status": "decided",
  "context": "Pipeline de dogfood progressivo pré-v0.8.0. Spec: docs/superpowers/specs/2026-05-29-colony-dogfood-design.md"
}
```

Substituir `DEC-BUD-XXX` pelo próximo ID sequencial disponível no arquivo.

- [ ] **Commit**

```bash
git add .project/tasks.json .project/decisions.json
git commit -m "chore(project): promover tasks P3 para colony-experiment-phase1"
```

---

## Task 5: Pre-flight antes dos experimentos operacionais

**Files:** nenhum (verificação)

- [ ] **Gate de saúde do runtime**

```bash
pnpm run pi:runtime:health
```

Esperado: `decision=continue`. Se retornar `decision=stop` ou `decision=investigate`, **não avançar** — ler o output do watchdog e resolver antes.

- [ ] **Gate de paridade local**

```bash
pnpm run ci:local:parity
```

Esperado: todos os checks passam (smoke, boundary, docs, discourse, complexity).

- [ ] **Confirmar que colony-pilot carrega no pi:dev**

```bash
pnpm run pi:dev --dry-run 2>/dev/null | grep -i colony || echo "colony não aparece no dry-run — verificar settings"
```

Se o Pi não tiver `--dry-run`, iniciar uma sessão curta e verificar que `/cpanel` ou o painel de colônia aparece no footer TUI.

---

## [Operacional] Executar os 3 experimentos de Fase 1

Estes passos são sessões Pi, não mudanças de código. Executar uma task por vez, aguardar gate humano antes da próxima.

**Experimento 1 — TASK-BUD-676 (claude-mem):**

```bash
pnpm run pi:dev
# No Pi TUI: usar colony-dogfood skill, selecionar TASK-BUD-676
# maxCost: 2.0, goal: ver SKILL.md seção "Fase 1 Research"
# Output esperado: .project/reports/TASK-BUD-676-research.md
```

Gate humano → preencher `.project/reports/TASK-BUD-676-decision.md`

**Experimento 2 — TASK-BUD-521 (sandcastle):**

Só após gate do experimento 1 aprovado.

```bash
# maxCost: 2.0, TASK-BUD-521
# Output esperado: .project/reports/TASK-BUD-521-research.md
```

Gate humano → `.project/reports/TASK-BUD-521-decision.md`

**Experimento 3 — TASK-BUD-480 (hermes-agent):**

Só após gate do experimento 2 aprovado.

```bash
# maxCost: 2.0, TASK-BUD-480
# Output esperado: .project/reports/TASK-BUD-480-research.md
```

Gate humano → `.project/reports/TASK-BUD-480-decision.md`

Após os 3 experimentos, commitar os artefatos:

```bash
git add .project/reports/TASK-BUD-676-research.md \
        .project/reports/TASK-BUD-676-decision.md \
        .project/reports/TASK-BUD-521-research.md \
        .project/reports/TASK-BUD-521-decision.md \
        .project/reports/TASK-BUD-480-research.md \
        .project/reports/TASK-BUD-480-decision.md
git commit -m "docs(reports): artefatos dos 3 experimentos colony Fase 1"
```

---

## Task 6: Promover melhor síntese para docs/research/

**Files:**
- Create: `docs/research/colony-dogfood-TASK-ID-synthesis.md` (melhor artefato)

Após os experimentos, escolher o artefato mais rico e promovê-lo para `docs/research/`.

- [ ] **Selecionar o melhor artefato**

Ler os três `*-research.md`. O melhor candidato é aquele com maior densidade de padrões aplicáveis ao agents-lab e menor risco de desatualização rápida.

- [ ] **Criar o arquivo em docs/research/**

```bash
cp .project/reports/TASK-BUD-NNN-research.md docs/research/colony-dogfood-TASK-BUD-NNN-synthesis.md
```

Adicionar frontmatter no topo do arquivo copiado:

```markdown
---
title: "Síntese Colony Dogfood: [nome da task]"
date: 2026-05-29
evidence_type: colony-dogfood-experiment
task: TASK-BUD-NNN
status: selected
---
```

- [ ] **Verificar que o site renderiza sem erro**

```bash
pnpm run test:docs:site
```

Esperado: sem erros de broken links ou frontmatter inválido.

- [ ] **Commit**

```bash
git add docs/research/colony-dogfood-TASK-BUD-NNN-synthesis.md
git commit -m "docs(research): promover síntese colony-dogfood TASK-BUD-NNN"
```

---

## Task 7: Escrever docs/guides/colony-self-use.md

**Files:**
- Create: `docs/guides/colony-self-use.md`

Este é o guia externo que prova o valor para quem vai instalar a pi-stack. Deve ser reproduzível por terceiros.

- [ ] **Criar o guia**

Criar `docs/guides/colony-self-use.md`:

```markdown
---
title: "Colony Self-Use: agents-lab como exemplo de si mesmo"
description: Como usar a colônia Pi nativa para conduzir experimentos de research e código com governança explícita.
---

# Colony Self-Use

O agents-lab usa sua própria colônia Pi para evoluir. Esta página documenta
o pipeline de dogfood progressivo executado antes da release v0.8.0 e mostra
como reproduzir o mesmo fluxo na sua instalação.

## O que foi feito

Durante o ciclo pré-v0.8.0, a colônia executou 3 experimentos de research
a partir de `.project/tasks.json`, produzindo sínteses que alimentam
decisões de código subsequentes. Os artefatos estão em:

- `.project/reports/TASK-BUD-676-research.md` — claude-mem e session continuity
- `.project/reports/TASK-BUD-521-research.md` — sandcastle e isolamento
- `.project/reports/TASK-BUD-480-research.md` — hermes-agent e control-plane

A melhor síntese foi promovida para [`docs/research/`](../research/).

## Como reproduzir

### Pré-requisitos

- `@aretw0/pi-stack` instalado (`npx @aretw0/pi-stack`)
- `pnpm run pi:runtime:health` retornando `decision=continue`
- Colônia ativa no seu `.pi/settings.json` (remover `!extensions/colony-pilot.ts` se presente)

### Estrutura de um experimento

Cada experimento segue três fases com gates humanos:

```
task selecionada do board
    ↓
colony worker (Fase 1 — research, maxCost: $2)
    ↓
.project/reports/TASK-ID-research.md
    ↓  gate humano
.project/reports/TASK-ID-decision.md (approved: true/false)
    ↓  se aprovado
colony worker (Fase 2 — impl-plan, maxCost: $1)
    ↓  gate humano
colony worker (Fase 2 — código, maxCost: $5)
    ↓  gate de smoke + gate humano
merge
```

### Usando o skill colony-dogfood

O skill `colony-dogfood` do `@aretw0/lab-skills` guia o Pi por todo o
protocolo. No Pi TUI, basta referenciar o skill:

```
use colony-dogfood skill for TASK-BUD-NNN
```

### Budget de referência

| Fase | maxCost sugerido |
|------|-----------------|
| Research | $2.00 |
| Impl-plan | $1.00 |
| Implementação | $5.00 |

O `hardCapUsd` configurado em `.pi/settings.json` protege contra runaway.

## Governança

Nenhum worker tem permissão de push direto. Todo código produzido fica em
branch local até o operador revisar o diff e aprovar o merge. O budget
envelope é explícito por experimento — não há execução de colônia sem
`maxCost` definido.

Evidência de cada execução fica em `.project/reports/` e pode ser auditada
ou contestada a qualquer momento.
```

- [ ] **Verificar que o guia aparece no site**

```bash
pnpm run test:docs:site
pnpm run repo:discourse:audit
```

Esperado: sem erros. O guide deve aparecer na navegação de `docs/guides/`.

- [ ] **Commit**

```bash
git add docs/guides/colony-self-use.md
git commit -m "docs(guides): adicionar colony-self-use — pipeline de dogfood pré-v0.8.0"
```

---

## Verificação Final

```bash
pnpm run ci:local:parity
```

Esperado: todos os checks passam com os novos arquivos incluídos.

Se tudo verde: o ciclo pré-v0.8.0 está documentado e provado. A release note
de v0.8.0 pode referenciar `docs/guides/colony-self-use.md` e
`docs/research/colony-dogfood-*` como evidência do pipeline de auto-uso.
