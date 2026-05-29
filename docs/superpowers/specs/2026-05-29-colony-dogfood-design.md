# Design: agents-lab como exemplo de si mesmo — colony dogfood progressivo

**Data:** 2026-05-29
**Status:** aprovado pelo operador
**Milestone alvo:** pré-v0.8.0

## Contexto

O agents-lab chegou a um ponto onde o control-plane, o watchdog, o intent-intake, o brainstorm/seed-decision pipeline e a infraestrutura da colônia estão maduros e testados. O scheduler está intencionalmente vazio — o único bloqueador real para v0.8.0 é uma decisão de versão. Antes de lançar, o objetivo é que o lab use sua própria stack Pi (colônia nativa, control-plane, budget governance) para evoluir a si mesmo, produzindo evidência interna e material externo que prove o valor antes da release.

## Objetivo

Executar um ciclo de auto-uso onde:

1. O Pi control-plane seleciona e coordena trabalho do `.project/tasks.json`
2. Workers da colônia (Pi nativo) executam tarefas em dois tempos: research → código
3. Gates humanos explícitos separam cada fase
4. A evidência vai para `.project/reports/` (interno) e é promovida para `docs/` (externo)
5. A release note de v0.8.0 conta a história com prova

## Arquitetura: três camadas

```
┌─────────────────────────────────────────────────────────┐
│  COORDENAÇÃO  (Pi control-plane — já existe)            │
│                                                         │
│  intent-intake → brainstorm → seed-decision             │
│       ↓                                                 │
│  .project/tasks.json  (fonte de trabalho)               │
└────────────────────┬────────────────────────────────────┘
                     │ colony-dispatch
                     ▼
┌─────────────────────────────────────────────────────────┐
│  EXECUÇÃO  (colony workers — Pi nativo)                 │
│                                                         │
│  Fase 1: tarefas research/análise (budget pequeno)      │
│  Fase 2: tarefas de código (budget maior, gate mais     │
│          rigoroso)                                      │
└────────────────────┬────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────┐
│  EVIDÊNCIA                                              │
│  .project/reports/  (interno)                           │
│  docs/research/ → docs/guides/  (externo)               │
└─────────────────────────────────────────────────────────┘
```

O "progressivo" refere-se ao **risco do trabalho**, não ao executor. A colônia nativa roda nas duas fases; a diferença é que Fase 1 produz documentos de análise e Fase 2 produz commits.

## Fase 1: research com colônia

### Activation contract

Uma task sai de `protected-parked-legacy` para colony dispatch pelo seguinte caminho:

```
tasks.json: status "planned" + milestone "protected-parked-legacy"
    ↓  operador promove explicitamente (entrada em decisions.json)
tasks.json: status "in_progress" + milestone "colony-experiment-phase1"
    ↓  Pi control-plane abre execution envelope
colony worker: executa com budget explícito
    ↓  produz artefato de síntese
gate humano
    ↓  aprovado
tasks.json: status "completed"
artefato em .project/reports/
```

### Estrutura de artefatos por experimento

```
.project/
  reports/
    TASK-BUD-NNN-research.md     ← síntese produzida pelo worker
    TASK-BUD-NNN-decision.md     ← decisão pós-gate humano
  decisions.json                 ← entrada de promoção da task
```

### Budget Fase 1

- Cap: ~50k tokens por sessão de worker
- Permissões: read de repos/docs externos + write de `.project/reports/` apenas
- Sem escrita de código, sem push, sem PR
- Se o cap for atingido sem síntese completa: artefato parcial é salvo, task volta para `planned` com nota de evidência parcial coletada

### Experimentos em ordem de risco crescente

| # | Task | Natureza | Output esperado |
|---|---|---|---|
| 1 | TASK-BUD-676 (claude-mem) | Avalia repo de memória/sessão | Síntese de padrões aplicáveis ao context-watchdog |
| 2 | TASK-BUD-521 (sandcastle) | Avalia isolamento/sandboxing | Síntese comparativa com bwrap atual |
| 3 | TASK-BUD-480 (hermes-agent) | Avalia control-plane externo | Mapa de padrões reaproveitáveis para o control-plane local-first |

TASK-BUD-676 abre o ciclo por ter maior ancoragem de contexto no repo (context-watchdog já existe), reduzindo o risco de divagação do worker.

## Fase 2: código com colônia

### Pré-condição

Fase 2 só se abre para uma task se o `TASK-ID-decision.md` existir com `approved: true`. O operador decide por task — pesquisa pode resultar apenas em documento de decisão, sem código.

### Contrato de execução

```
Fase 1 aprovada
    ↓
Worker recebe: task + artefato de research + contexto de código relevante
    ↓  [step report-only]
Worker propõe plano de implementação → .project/reports/TASK-ID-impl-plan.md
    ↓  gate humano: operador aprova plano
Worker implementa → branch + commit + entrada de changeset
    ↓  gate de verificação: smoke focal passa
    ↓  gate humano: operador revisa diff
Merge + task.status = "completed"
```

### Budget Fase 2

- Cap: ~150k tokens por sessão de worker
- Worker sem permissão de push direto — produz branch, operador faz o merge
- Se smoke falhar: worker anota falha no artefato e para — sem loop de auto-correção na primeira iteração do pipeline

## Contrato de evidência externa

Três camadas de visibilidade crescente, em ordem de promoção:

```
INTERNO                    EXTERNO (promoção)
─────────────────────────────────────────────────────────
.project/reports/          →  docs/research/TASK-ID-synthesis.md
  (artefatos brutos)            (evidência datada selecionada)
                                      ↓
                           docs/guides/colony-self-use.md
                                (como reproduzir o fluxo)
                                      ↓
                           CHANGELOG / release notes v0.8.0
                                (o que foi construído pela colônia)
```

### O que `colony-self-use.md` precisa conter para ser reproduzível

1. Como ativar um worker com budget explícito no `pi:dev`
2. O formato do execution envelope e do artefato de research
3. Onde ficam os gates de aprovação humana
4. Um experimento completo documentado end-to-end (o melhor dos três)

### O arco da release note v0.8.0

Não é "adicionamos colony support" — é "usamos a colônia para construir partes desta versão, e aqui está a evidência e o guia para você fazer o mesmo."

## Ciclo completo

```
Pi seleciona task → colônia pesquisa → operador aprova
    → colônia implementa → evidência no repo
        → v0.8.0 conta a história com prova
```

## Não-objetivos

- Substituir a supervisão humana por automação total neste ciclo
- Criar perfis operacionais duráveis adicionais para a colônia
- Push ou publish automático por worker sem gate explícito
- Usar claude-code-adapter como executor (foco é Pi nativo)

## Gates de mudança antes de iniciar

```bash
pnpm run pi:runtime:health       # decision=continue obrigatório
pnpm run ci:local:parity         # baseline limpa antes de ativar workers
pnpm exec vitest run packages/pi-stack/test/smoke/guardrails-structured-interview.test.ts
```
