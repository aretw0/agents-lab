# @davidorex/pi-project-workflows — first-party coverage inventory

Data: 2026-06-23
Status: investigação concluída (decision-grade); insumo para o corte evidence-gated
Relacionado: `docs/superpowers/specs/2026-06-22-mariozechner-sovereignty-eval-convergence.md`,
`docs/superpowers/specs/2026-06-23-ppw-capability-tasks-design.md`,
`experiments/202606-eval-contract-baseline/tasks/ppw.mjs`

## Por que esta investigação

A convergência soberania↔eval define como **primeira investigação** a coluna
"cobertura first-party" do `@davidorex/pi-project-workflows` (dep do perfil
**default** `strict-curated`). Ela decide se a soberania-default é *"soltar uma
dep"* ou *"construir/elevar um substituto"*. Este documento é a tabela viva
datada que o spec de convergência pede.

## Achado estrutural: o umbrella é um shim

`@davidorex/pi-project-workflows@0.14.6` (declarado só em
`packages/pi-stack/package.json`) é um **umbrella** fino. Cada extensão é um
re-export de uma linha:

| extensão do umbrella | re-exporta | impl real |
|---|---|---|
| `monitors-extension.ts` | `@davidorex/pi-behavior-monitors` | classifier de comportamento |
| `project-extension.ts` | `@davidorex/pi-project` | engine de blocos `.project/` |
| `workflows-extension.ts` | `@davidorex/pi-workflows` | execução de workflows YAML |

Os **três sub-pacotes arrastam `@mariozechner` diretamente** (são os draggers
reais; o umbrella só os agrega):

| sub-pacote | deps @mariozechner diretas |
|---|---|
| `@davidorex/pi-behavior-monitors` | `pi-ai`, `pi-coding-agent`, `pi-tui` |
| `@davidorex/pi-project` | `pi-coding-agent` |
| `@davidorex/pi-workflows` | `pi-ai`, `pi-coding-agent`, `pi-tui` |

Implicação: cortar/substituir as **três** capacidades é o que remove o
`@mariozechner` do perfil default. Um corte parcial (ex.: só monitors) reduz, mas
não zera, o arrasto — qualquer sub-pacote remanescente mantém a cadeia.

## Taxonomia existente (`capability-owners.json`)

Já codifica `@aretw0/pi-stack` como **primary** e o dep como **secondary** em
duas capacidades — mas elas são as *superfícies* (governance/board), distintas
dos *engines* profundos que o dep entrega:

| capability id | primary | secondary | nota |
|---|---|---|---|
| `monitor-provider-governance` | `@aretw0/pi-stack` | `@davidorex/pi-project-workflows` | + `conflictsWithPackages: @davidorex` |
| `project-board-surface` | `@aretw0/pi-stack` | `@davidorex/pi-project-workflows` | — |

## Cobertura first-party por capacidade

### 1. monitors — impl real `@davidorex/pi-behavior-monitors`

- **O que o dep entrega:** monitores de comportamento via **classify LLM**
  (`systemPrompt`/`complete()`), com hedge/fragility semânticos e o comando
  `/monitors`. (Contrato verificado em `scripts/verify-pi-stack.mjs` —
  `monitor classify contract (systemPrompt -> complete payload)`.)
- **First-party hoje:** `packages/pi-stack/extensions/monitor-sovereign.ts` — um
  primitivo **audit/shadow** (`@capability-id monitor-provider-governance`). Seu
  `classifyShadow` usa **heurísticas determinísticas** (regex no último comando
  bash; `facts.blockedToolResults > 0`), **não** o classify LLM. O próprio
  docblock lista **"full parity with @davidorex/pi-behavior-monitors" como
  NON-GOAL** desta fase. Está em
  `PI_STACK_CONTROL_PLANE_EXTENSION_EXCLUDES` (`install.mjs:61`) → **excluído do
  runtime diário strict-curated**. `monitor-runtime-contract.ts` ainda nomeia
  `pi-behavior-monitors` como o classify runtime do default.
- **Veredito:** **dep-only para paridade.** O first-party oferece uma camada
  determinística de observabilidade que *vigia* os monitores third-party — não os
  substitui.
- **Caminho de soberania:** elevar `monitor-sovereign` a classificador real,
  **ou** forkar o classify runtime como first-party, **ou** aceitar
  monitoramento reduzido (determinístico) e rebaixar a capacidade.

### 2. project — impl real `@davidorex/pi-project`

- **O que o dep entrega:** engine **genérico** de blocos `.project/` —
  `append-block-item`/`update-block-item` com **validação de schema automática**,
  blocos arbitrários (issues/decisions/custom), integridade referencial entre
  blocos e scaffolding de estrutura de projeto.
- **First-party hoje:** `packages/pi-stack/extensions/project-board-*` — uma
  **superfície de board/tasks** sobre `.project/*`: modelo com status tipados
  (planned/in-progress/blocked/completed), query/update/mutations/governance/
  completion/backfill, cache por mtime (`project-board-surface.ts`,
  `project-board-model.ts`, `project-board-mutations.ts`,
  `project-board-verification-backfill.ts`). Especializado ao loop de board; não
  há engine genérico first-party de bloco-tipado + validação-de-schema.
- **Veredito:** **parcial.** Superfície de board/tasks coberta first-party; o
  engine genérico (schema automático + integridade referencial + scaffolding) é
  dep-only.
- **Caminho de soberania:** confirmar o que o lab realmente usa. Se só o
  board/tasks → praticamente coberto. Se blocos genéricos com schema → construir
  o engine genérico first-party.

### 3. workflows — impl real `@davidorex/pi-workflows`

- **O que o dep entrega:** execução de **workflows YAML**.
- **First-party hoje:** **nenhuma.** Os matches de "workflow" são skills de
  processo (`git-workflow`, `pi-dev-workflow`) e guardrails de agent-run — não um
  runner de workflows YAML.
- **Veredito:** **GAP.**
- **Caminho de soberania:** construir um substituto first-party, **ou** mover a
  capacidade para a camada opt-in (deixar de ser default).

## Tabela-resumo (inventário)

| capability | impl real (sub-pacote) | cobertura first-party | veredito | decisão default |
|---|---|---|---|---|
| monitors | `@davidorex/pi-behavior-monitors` | shadow determinístico (excluído do default; paridade = non-goal) | dep-only p/ paridade | **construir/elevar substituto** |
| project | `@davidorex/pi-project` | superfície board/tasks sobre `.project/*` | parcial | **confirmar uso; engine genérico só se necessário** |
| workflows | `@davidorex/pi-workflows` | nenhuma | gap | **construir substituto ou mover p/ opt-in** |

**Conclusão:** a soberania-default deste dep é **"construir/substituir", não "só
soltar"** — pelo menos para monitors e workflows. Como o umbrella arrasta o
`@mariozechner` via os três sub-pacotes, o `@mariozechner` só sai do perfil
default quando as **três** capacidades estiverem cobertas/cortadas.

## Ligação com o eval-lab (gate)

As três tarefas de capacidade já existem e medem a presença do dep:
`experiments/202606-eval-contract-baseline/tasks/ppw.mjs` (`ppw-monitors`,
`ppw-project`, `ppw-workflows`), verdes hoje com o dep instalado
(`tests/ppw.test.mjs` = baseline "antes"). Quando um substituto first-party
existir, a forma evidence-gated é **repontar os `env.artifacts` de cada tarefa**
para a superfície first-party (ou autorar tarefas-irmãs) e provar verde **sem** o
dep antes de removê-lo de `packages/pi-stack/package-list.mjs`.

## Próximos passos sugeridos (em ordem)

1. **workflows** (gap puro): decidir build-substituto vs. mover-para-opt-in — é o
   corte mais limpo conceitualmente (sem ilusão de cobertura).
2. **monitors:** decidir entre elevar `monitor-sovereign` ao classify real,
   forkar o runtime, ou rebaixar a capacidade — e refletir a escolha no
   `monitor-runtime-contract.ts` e nos excludes.
3. **project:** auditar o uso real (board/tasks vs. blocos genéricos) e só então
   dimensionar o engine genérico.
4. Espelhar o veredito no `docs/research/0-8-readiness-map.md` e no
   `mariozechner-sovereignty-gate`.

## Evidência (como reproduzir)

- Umbrella shim: `cat` das 3 `*-extension.ts` em
  `node_modules/.pnpm/@davidorex+pi-project-workflows@0.14.6_*/node_modules/@davidorex/pi-project-workflows/`.
- Arrasto @mariozechner: `package.json` de cada sub-pacote em `node_modules/.pnpm/`.
- monitors shadow vs classify: `packages/pi-stack/extensions/monitor-sovereign.ts`
  (docblock + `classifyShadow`), `monitor-runtime-contract.ts`, `install.mjs:48-71`.
- project: `project-board-{surface,model,mutations,verification-backfill}.ts`;
  skill do dep `.../skills/pi-project/SKILL.md`.
- workflows: ausência de runner YAML first-party em `packages/*/{extensions,skills}`.
