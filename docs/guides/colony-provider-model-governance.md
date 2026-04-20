# Governança de Provider/Modelo para Colônia e Multi-Agentes

Guia para reduzir fricção ao usar `ant_colony` com múltiplos providers (Copilot/Codex/etc.) no `@aretw0/pi-stack`.

## Objetivo

Garantir que o uso de multi-agentes fique previsível para:

- **usuários da stack** (rodar colônia sem travar por config oculta)
- **devs do agents-lab** (evoluir para primitivas first-party sem lock-in)

---

## Superfícies de configuração (quem controla o quê)

| Superfície | Onde configurar | Impacto |
|---|---|---|
| Sessão principal | `defaultProvider` / `defaultModel` em settings | Modelo usado pela sessão atual do pi |
| Classifiers de monitor | `piStack.monitorProviderPatch.*` + `/monitor-provider` | Saúde dos monitores (`hedge`, `fragility`, etc.) |
| Colônia (`ant_colony`) | modelo atual da sessão + overrides por caste | Scout/worker/soldier e classes específicas |
| Governança de execução da colônia | `piStack.colonyPilot.preflight.*` + `/colony-pilot` | Gate de capacidades/executáveis antes de rodar |
| Governança de orçamento da colônia | `piStack.colonyPilot.budgetPolicy.*` + `/colony-pilot` | Exigir/injetar `maxCost`, cap de custo e mínimo operacional |

---

## Estado atual no agents-lab

### 1) Monitores (davidorex)

Resolvido com patch provider-aware:

- `monitor-provider-patch`
- comando `/monitor-provider status|apply|template`
- defaults por provider (Copilot/Codex)

### 2) Colônia (`@ifi/oh-pi-ant-colony`)

Comportamento importante:

- `ant_colony` usa **modelo atual da sessão** por padrão (`provider/model` completo)
- pode receber overrides por papel:
  - `scoutModel`, `workerModel`, `soldierModel`
  - `designWorkerModel`, `multimodalWorkerModel`, `backendWorkerModel`, `reviewWorkerModel`

### 3) Pilot de orquestração (`colony-pilot` first-party)

`/colony-pilot check` agora cobre:

- capacidades carregadas (`/monitors`, `/colony`, `/colony-stop`, `/session-web`)
- readiness de provider/model (modelo atual + `defaultProvider/defaultModel`)
- avaliação da **model policy** por classe (queen/scout/worker/soldier/design/multimodal/backend/review)
- avaliação da **budget policy** (`maxCost`, hard cap, mínimo) para `ant_colony`

> Convenção: `/doctor` é saúde global. `/colony-pilot` e `/monitor-provider` são diagnósticos de domínio.

---

## Modelos recomendados (baseline prático)

### Perfil Copilot

- scout: `github-copilot/claude-haiku-4.5`
- worker: `github-copilot/claude-sonnet-4.6`
- soldier: `github-copilot/claude-sonnet-4.6`

### Perfil Codex

- scout: `openai-codex/gpt-5.4-mini`
- worker: `openai-codex/gpt-5.3-codex`
- soldier: `openai-codex/gpt-5.2-codex`

> Heurística: scout mais barato/rápido, worker/soldier mais fortes.

### Spark gating policy (OpenAI Codex)

Para preservar a cota PRO separada de `gpt-5.3-codex-spark`, a política operacional é:

- **padrão**: usar cota normal (`gpt-5.3-codex` / `gpt-5.4-mini` / `gpt-5.2-codex`)
- **Spark só com gatilho explícito no goal**:
  - `planning recovery`
  - `scout burst`
- Sem gatilho explícito, uso de modelo `*-spark` deve ser bloqueado por policy.
- Com gatilho `scout burst`, uso de Spark fica restrito ao papel `scout`.
- Para uso amplo de Spark (múltiplos papéis), o goal deve conter `planning recovery`.

Config recomendada em `.pi/settings.json`:

```json
{
  "piStack": {
    "colonyPilot": {
      "modelPolicy": {
        "sparkGateEnabled": true,
        "sparkAllowedGoalTriggers": ["planning recovery", "scout burst"],
        "sparkScoutOnlyTrigger": "scout burst"
      }
    }
  }
}
```

### Policy de retenção de candidate churn (first-party)

Para reduzir perda de contexto quando mirrors/worktrees desaparecem (cleanup externo),
o `colony-pilot` mantém retenção local em `.pi/colony-retention/*.json` para sinais terminais.

Configuração em `.pi/settings.json`:

```json
{
  "piStack": {
    "colonyPilot": {
      "candidateRetention": {
        "enabled": true,
        "maxEntries": 40,
        "maxAgeDays": 14
      }
    }
  }
}
```

Notas operacionais:

- sem config explícita, defaults internos: `maxEntries=40`, `maxAgeDays=14`;
- valores são normalizados/clampados em runtime (`maxEntries: 1..500`, `maxAgeDays: 1..365`);
- prune determinístico roda em gravação de registro (inclusive quando conteúdo não mudou);
- observabilidade:
  - `colony_pilot_status` expõe `retention.config` + resumo;
  - `colony_pilot_artifacts` inclui inventário de retenção mesmo sem mirror local.

---

## Checklist operacional (usuário pi-stack)

1. `/doctor` (saúde global)
2. `/monitor-provider status`
3. `/monitor-provider apply` (se houver drift)
4. `/colony-pilot models apply codex` (perfil generic-first para ambiente Codex-only)
5. `/colony-pilot models status`
6. `/colony-pilot check`
7. `/colony-pilot preflight`
8. rodar colônia com budget explícito (`ant_colony` com `maxCost`)
9. monitorar janela/limite com `/usage` + histórico com `/quota-visibility windows`

Se quiser observabilidade web local:

- `/session-web start`
- `/colony-pilot status`

### Diretriz atual: generic-first

No estado atual do laboratório (especialmente quando só há Codex disponível), a recomendação é:

- priorizar papéis genéricos (`scout`, `worker`, `soldier`)
- manter papéis especializados (`design`, `multimodal`, `backend`, `review`) como **opt-in**
- só endurecer especialização quando houver evidência de ganho

Isso evita crescimento acidental de complexidade e melhora coesão da arquitetura.

### Perfis rápidos de model policy

- `/colony-pilot models template codex`
- `/colony-pilot models apply codex`
- `/colony-pilot models apply copilot`
- `/colony-pilot models apply hybrid`
- `/colony-pilot models apply factory-strict`
- `/colony-pilot models apply factory-strict-copilot`
- `/colony-pilot models apply factory-strict-hybrid`

Esses perfis escrevem `piStack.colonyPilot.modelPolicy` no `.pi/settings.json` e ativam hard-gate no `tool_call` de `ant_colony`.

A baseline também pode configurar `piStack.colonyPilot.budgetPolicy` para exigir/injetar `maxCost` e bloquear caps acima do limite definido.

Perfis rígidos para fábrica de agentes:
- `factory-strict` (Codex-only)
- `factory-strict-copilot` (Copilot-only)
- `factory-strict-hybrid` (mix permitido, mas com allowlist por role)

Todos eles:
- exigem modelos explícitos para todas as classes (scout/worker/soldier/design/multimodal/backend/review)
- exigem referência completa `provider/model`

No `factory-strict-hybrid`, a mistura de provider é controlada por papel (`allowedProvidersByRole`), por exemplo:
- `worker/review/design` em Copilot
- `scout/soldier/backend/multimodal` em Codex

---

## Exemplo de `ant_colony` com overrides explícitos

```json
{
  "goal": "Refatorar módulo X com testes",
  "maxAnts": 3,
  "maxCost": 2,
  "scoutModel": "openai-codex/gpt-5.4-mini",
  "workerModel": "openai-codex/gpt-5.3-codex",
  "soldierModel": "openai-codex/gpt-5.2-codex"
}
```

---

## Diretrizes para devs do agents-lab

1. **Não usar chaves reservadas com shape inválido em settings**
   - `extensions` em settings é lista de paths (`string[]`), não objeto de config.
   - Config first-party deve ficar em namespace próprio: `piStack.<extensão>`.

2. **Sempre tratar provider/model como referência completa**
   - usar `provider/model` em defaults e docs.

3. **Separar responsabilidades**
   - `/doctor`: runtime global
   - comandos de domínio (`/monitor-provider`, `/colony-pilot`): validação específica

4. **Pensar em swarms como uma abordagem, não dogma**
   - colony é um estilo de orquestração útil hoje
   - primitivas first-party futuras devem manter contrato de configuração claro e intercambiável

---

## Relação com referências externas (ex.: tuts)

As referências de padrões multi-agente (incluindo exemplos tipo “tuts”) são úteis para desenho de arquitetura, mas no `agents-lab` o critério operacional é:

- configuração mínima explícita de provider/model
- diagnósticos reproduzíveis
- comandos de controle e recovery documentados

Ou seja, padrão conceitual externo entra, mas governança operacional segue os contratos do `pi-stack`.
