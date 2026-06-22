# Soberania do mariozechner provada por avaliação — design 0.8.0

Data: 2026-06-22
Status: design aprovado, pendente de plano de implementação

## Context

A 0.8.0 é o milestone em que o laboratório precisa parar de elevar versão sem
qualidade aceitável. Dois esforços convergiram nesta sessão:

1. **Capacidade de avaliação (eval-lab).** Tornar o laboratório capaz de *medir* —
   adotar a forma de benchmarks consolidados e construir os próprios — produzindo a
   leitura "básico↔avançado" como dado medido (tier + pass-rate), não opinião.
2. **Soberania do fork `@mariozechner` (bloqueio de release).** Uma Security Audit
   semanal (`pnpm run security:audit`) ficou vermelha em 2026-06-22 com 5 advisories
   high (undici ×3, ws, `@mariozechner/pi-coding-agent`), todos transitivos. O runtime
   próprio do lab **já está migrado** (`@earendil-works/pi-coding-agent@0.79.3`); a vuln
   vem só de terceiros curados não-migrados que ainda arrastam o fork antigo. O operador
   declarou: a 0.8.0 não faz release antes da soberania total desse fork.

Decisão: **acoplar os dois fortemente** — a soberania é *evidence-gated* pela avaliação.
Cada dependência que arrasta o mariozechner só é removida quando as tarefas que exercem a
capacidade dela passam verdes **sem** ela. O eval-lab nasce servindo a soberania (rede de
segurança do corte); a soberania nasce gerando o catálogo de tarefas do eval-lab.

## Goals

- Tornar o **perfil default (`STRICT_CURATED`)** soberano do `@mariozechner/*`.
- Caminhar para soberania total, incluindo a camada opt-in `@ifi/*`.
- Provar cada corte com evidência reproduzível, agnóstica de agente (Pi hoje, Refarm amanhã).
- Adicionar um `mariozechner-sovereignty-gate` ao release readiness da 0.8.0.

## Non-goals (agora)

- Construir os 4 adapters de benchmark (terminal-bench/Inspect/τ-bench/OpenEnv) — só a forma.
- Catálogo de tarefas exaustivo — só o que a soberania exige.
- Aposentar a camada avançada sem substituto medido (corte no escuro).
- Forçar `pnpm.overrides` de `@mariozechner/pi-coding-agent` (empurraria terceiros a um fork
  para o qual não foram construídos).

## Artefato que une os dois: o inventário de capacidades

Tabela viva (nasce em `docs/research/`, datada) mapeando cada dep que arrasta o mariozechner:

| dep | perfil | capacidades | cobertura first-party | tarefas eval (tier) | decisão |
|---|---|---|---|---|---|
| `@davidorex/pi-project-workflows` | **default** | monitors, project blocks, workflows | a investigar (`@aretw0/lab-skills` + `pi-stack`) | T1 project/monitor | soltar/substituir |
| `@ifi/oh-pi-ant-colony` | opt-in | colônia | — | T2 orquestração | aposentar/substituir |
| `@ifi/pi-extension-subagents` | opt-in | subagentes | — | T2 | — |
| `@ifi/pi-web-remote` | opt-in | web-remote | — | T3 interação | — |
| `@ifi/oh-pi-extensions`, `@ifi/pi-plan`, `@ifi/pi-spec` | opt-in | extras/plan/spec | — | T1–T2 | — |

A primeira coluna "cobertura first-party" do `@davidorex/pi-project-workflows` é a **primeira
investigação** (define se a soberania-default é "soltar uma dep" ou "construir substituto").

## Arquitetura

### Eval-harness (a primeira primitiva — rede de segurança)
Conforme o design já aprovado: nasce em `experiments/202606-eval-contract-baseline/`, promove
para `primitives/eval-contract/` quando reproduzível.

- `contract/` — core **pi-free** (vigiado por `scripts/engine-boundary-audit.mjs`): `task.ts`
  (instrução + ambiente + verificação + tier), `runner.ts` (setup → roda agente via interface →
  coleta → score; k repetições p/ variância), `report.ts` (datado → `.pi/reports`).
- `adapters/` — `agent-pi.ts` (reusa `scripts/agent-run-*-container-*.mjs`; Refarm = irmão
  futuro), `format-terminal-bench.ts` (lê `task.yaml`+`Dockerfile`+`tests/`).
- `tasks/` — tarefas das capacidades do inventário, começando pelo default-profile.
- testes do harness com **fake agent determinístico** (rápido, em CI); Pi real é opt-in/frio.

### Sequência evidence-gated (por dep)
1. harness mínimo existe;
2. autora as tarefas da capacidade da dep (tier apropriado);
3. **baseline** com a dep presente → evidência "antes";
4. soltar/substituir (first-party) → rodar as mesmas tarefas **sem** a dep;
5. **gate de corte:** a dep só sai de `packages/pi-stack/package-list.mjs` quando suas tarefas
   passam verdes sem ela;
6. ordem: **default-profile primeiro** (`@davidorex/pi-project-workflows`), depois `@ifi/*`.

### O `mariozechner-sovereignty-gate` (no release readiness)
Herda a doutrina destravada no fix de CI de 2026-06-22:
- **smoke sempre-ligado** checa a **árvore de deps** (determinística, versionada): `pnpm why
  @mariozechner/*` vazio no perfil default — sem depender de artefato efêmero;
- **release-time** verifica o **verdor das tarefas** de capacidade (evidência materializada).

Implementado como item no `scripts/release-readiness-report.mjs`, espelhado no
`docs/research/0-8-readiness-map.md`.

## Verification (como saberemos)

- `pnpm why @mariozechner/*` retorna vazio para o perfil default (e, na soberania total, p/ a
  árvore inteira).
- Para cada dep cortada: as tarefas de capacidade passam **sem** ela, com baseline registrado.
- `pnpm run security:audit` deixa de reportar highs do mariozechner (undici/ws caem junto, por
  saírem da mesma cadeia).
- `mariozechner-sovereignty-gate` presente no readiness e verde no perfil default.
- `pnpm run ci:local:parity` verde; `engine:boundary:audit` mantém o core do eval pi-free.

## Sequenciamento

1. Eval-harness mínimo (contrato + runner + agent-pi + fake agent) via TDD.
2. Investigar cobertura first-party de `@davidorex/pi-project-workflows`.
3. Tarefas + baseline da capacidade project/monitor.
4. Soltar/substituir `@davidorex/pi-project-workflows`; provar verde sem ela.
5. `mariozechner-sovereignty-gate` no readiness (smoke = árvore; release = tarefas).
6. Repetir para a camada opt-in `@ifi/*`.
