---
name: colony-dogfood
description: >
  Conduz um experimento de dogfood onde a colônia Pi executa uma task do
  .project/tasks.json em dois tempos (research → código) com gates do operador.
  Use quando o operador quiser ativar um experimento colony-experiment-phase1
  ou colony-experiment-phase2.
---

# Colony Dogfood

Este skill guia a execução de um experimento de auto-uso onde o agents-lab
usa sua própria colônia para evoluir. Siga os passos na ordem — nunca pule
um gate do operador.

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
- Não criar nem editar `.project/reports/TASK-ID-decision.md`; esse arquivo é exclusivo do operador

### 3. Output esperado do worker

O worker deve criar `.project/reports/TASK-ID-research.md` preenchendo todos
os campos do template. Se o budget for atingido antes da síntese estar
completa, o worker deve marcar `status: parcial` e salvar o que conseguiu.
Se o worker criar ou editar o arquivo de decisão, trate o gate como inválido
até nova revisão humana explícita.

### 4. Gate do operador (obrigatório)

Leia `.project/reports/TASK-ID-research.md`.
Preencha `.project/reports/TASK-ID-decision.md` a partir do template.
Marque `approved: true` ou `approved: false`.

Só avance para Fase 2 se `approved: true` E `Fase 2 autorizada?: sim`, ambos
preenchidos pelo operador humano.

## Fase 2: Código

### 1. Proposta de impl-plan

Com o gate aprovado, abra um segundo envelope colony:

- `goal`: "Ler .project/reports/TASK-ID-research.md e .project/reports/TASK-ID-decision.md. Propor plano de implementação em .project/reports/TASK-ID-impl-plan.md seguindo o template. NÃO implementar — apenas propor."
- `maxCost`: 1.0 (USD) — apenas leitura e escrita de documento

### 2. Gate do operador (obrigatório)

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

### 5. Gate do operador — revisão final

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
