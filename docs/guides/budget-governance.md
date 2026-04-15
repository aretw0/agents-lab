# Governança de Budget (laboratório + usuários da stack)

Guia para tratar custo como restrição de primeira classe em qualquer trabalho (incluindo swarm/colônia), com paridade e isolamento entre ambiente de laboratório e ambiente user-like.

## Objetivo

1. impedir execuções sem limite de custo claro;
2. manter evidência de consumo para operação e contestação;
3. garantir paridade de capacidades sem sujar o ambiente do laboratório.

---

## Conceito: Budget Envelope

Um **budget envelope** é o contrato mínimo de custo de uma execução.

Campos recomendados:
- `goal` (macro objetivo)
- `maxCost` (hard cap em USD)
- `owner` (quem abriu)
- `scope` (sessão/projeto/colônia)
- `evidence` (links para `/usage`, `/session-breakdown`, `/quota-visibility export`)
- `tasks` (decomposição do macro goal)

Sem envelope explícito, não há controle operacional real.

---

## Superfícies que se complementam

- **Live quota/rate-limit por provider:** `/usage` (`@ifi/oh-pi-extensions`)
- **Histórico de sessões:** `/session-breakdown` (`mitsupi`)
- **Auditoria independente/exportável:** `/quota-visibility` (`@aretw0/pi-stack`)

Não é "ou/ou"; é **camadas de observabilidade**.

### Budget compartilhado por provider (cota emprestada/time)

Quando você opera com chaves de colegas/time, configure orçamento por provider com percentual/cap acordado:

- comando de leitura: `/quota-visibility budget`
- config: `piStack.quotaVisibility.providerBudgets`

Modelo de operação:
- `period`: `weekly` (padrão) ou `monthly`;
- `unit`: `tokens-cost` (padrão) ou `requests` (recomendado para GitHub Copilot premium requests);
- semanal: `shareTokensPct` / `shareCostPct` / `shareRequestsPct` e `weeklyQuotaTokens` / `weeklyQuotaCostUsd` / `weeklyQuotaRequests`;
- mensal: `shareMonthlyTokensPct` / `shareMonthlyCostPct` / `shareMonthlyRequestsPct` e `monthlyQuotaTokens` / `monthlyQuotaCostUsd` / `monthlyQuotaRequests`;
- `requestSharePolicy`: `fixed` ou `remaining` (ex.: metade do disponível no momento);
- `warnPct` / `hardPct`: thresholds operacionais (`WARN` / `BLOCK`).

> Importante: no estado atual a separação é por **provider**. Separação por chave individual/conta no mesmo provider exige tagging adicional na ingestão de eventos (trilha futura provider-agnostic).

---

## Colônia e budget

### Ponto crítico

`/colony <goal>` (comando) não expõe `maxCost` na CLI.

Para hard cap explícito, use o caminho com `ant_colony` e `maxCost`.

### Política no `colony-pilot`

`piStack.colonyPilot.budgetPolicy` permite:
- exigir `maxCost`;
- auto-injetar `defaultMaxCostUsd`;
- bloquear acima de `hardCapUsd`;
- bloquear abaixo de `minMaxCostUsd`;
- bloquear launch quando provider usado estiver em `BLOCK` (`enforceProviderBudgetBlock`);
- permitir override auditável no goal (`providerBudgetOverrideToken`, ex.: `budget-override:<motivo>`).

`piStack.guardrailsCore.providerBudgetGovernor` permite enforcement global (não só swarm):
- bloqueia prompts normais quando provider atual está em `BLOCK`;
- mantém allowlist de recovery commands (`/doctor`, `/quota-visibility`, `/model`, `/login`);
- aceita override auditável com token configurável.

`piStack.colonyPilot.projectTaskSync` (opt-in) permite sincronizar eventos de colônia para `.project/tasks`:
- criar task no launch;
- anexar progresso por sinal;
- refletir estado terminal como candidato (com fechamento humano).
Exemplo:

```json
{
  "piStack": {
    "colonyPilot": {
      "budgetPolicy": {
        "enabled": true,
        "enforceOnAntColonyTool": true,
        "requireMaxCost": true,
        "autoInjectMaxCost": true,
        "defaultMaxCostUsd": 2,
        "hardCapUsd": 20,
        "minMaxCostUsd": 0.05,
        "enforceProviderBudgetBlock": true,
        "providerBudgetLookbackDays": 30,
        "allowProviderBudgetOverride": true,
        "providerBudgetOverrideToken": "budget-override:"
      },
      "projectTaskSync": {
        "enabled": true,
        "createOnLaunch": true,
        "trackProgress": true,
        "markTerminalState": true,
        "taskIdPrefix": "colony",
        "requireHumanClose": true,
        "maxNoteLines": 20
      }
    }
  }
}
```

---

## Paridade + isolamento

Antes de concluir que "falta funcionalidade", rode:

```bash
npm run pi:parity
npm run pi:parity:project
```

- `pi:parity` valida se seu **user scope** está próximo da stack completa.
- `pi:parity:project` valida o **scope local do laboratório** (first-party).

Para isolamento forte em estudos (sem sujar `~/.pi/agent`):

```bash
# exemplo (PowerShell)
$env:PI_CODING_AGENT_DIR = "$PWD/.sandbox/pi-agent"
pi list
```

Isso permite pesquisar e desenvolver sem confundir ausência de pacote com ausência de feature.

---

## Workflow recomendado por execução

1. Confirmar paridade (`pi:parity`) no contexto da análise.
2. Definir budget envelope (goal + maxCost + escopo + owner).
3. Abrir/atualizar task em `.project/tasks.json`.
4. Rodar execução com budget (`ant_colony` com `maxCost` quando for swarm).
5. Coletar evidência (`/usage`, `/quota-visibility export`).
6. Revisar resultados com humano antes de fechar tasks.

> Para disciplina operacional completa (cleanroom, promoção de candidate e reconciliação de drift), ver também: [`swarm-cleanroom-protocol.md`](./swarm-cleanroom-protocol.md).

---

## Regra de governança de tasks

Para esta iniciativa: **não fechar task automaticamente** no fim da sessão.

Fechamento só após etapa de revisão com você (humano), validando:
- o que foi criado;
- o que foi concluído;
- o que ficou pendente/risco.
