# RFC — Soberania da Stack Pi (Curadoria e Centralização)

Status: Proposed (P0 rollout)
Data: 2026-04-14
Owner: @aretw0/pi-stack

## A) Resumo executivo (1 página)

A stack atual é funcional, mas sofre fragmentação por sobreposição semântica entre pacotes third-party e first-party. O maior risco operacional hoje é governança concorrente em runtime compartilhado (ex.: scheduler ownership/lease). A iniciativa define um **modelo de soberania** com owners claros por capability, default seguro, regras de coexistência e playbooks de incidentes.

### Problemas encontrados

1. **Scheduler concorrente**
   - Evidência: `@ifi/oh-pi-extensions/extensions/scheduler.ts`
     - `handleStartupOwnership()` oferece takeover/disable/clear no startup interativo.
     - `takeOverScheduler()`, `disableForeignTasks()`, `clearForeignTasks()` executam mutações destrutivas.
   - Lease/task persistidos em:
     - `scheduler-shared.ts`: `getSchedulerStoragePath()`, `getSchedulerLeasePath()`.
   - Impacto: takeover não coordenado, limpeza/desabilitação de foreign tasks sem política stack-level.

2. **Overlap semântico de governança runtime**
   - Guardrails e supervisão em múltiplas camadas:
     - `@ifi/oh-pi-extensions`: safe-guard/git-guard/watchdog/scheduler.
     - `@aretw0/pi-stack`: guardrails-core, environment-doctor, colony-pilot, scheduler-governance.
   - Impacto: decisões paralelas sem contrato único de precedência.

3. **Composição com filtros ainda parcial**
   - Evidência: `packages/pi-stack/install.mjs` (`FILTER_PATCHES`) já resolve colisões conhecidas, mas overlap semântico permanece.

### Decisão principal

Adotar o modelo:

- **Owner por capability** (source of truth explícito);
- **Default seguro e conservador** (observe/review);
- **Ações destrutivas só com confirmação textual forte**;
- **Non-interactive sempre conservador**;
- **Contrato mínimo obrigatório para extensões de background**.

### Resultado imediato desta rodada

- Nova extensão first-party: `scheduler-governance`.
- Novo comando: `/scheduler-governance` (`status/policy/apply`).
- Nova tool: `scheduler_governance_status`.
- Hard-guards:
  - takeover/disable/clear exigem confirmação textual em UI.
  - non-interactive bloqueia destrutivo automaticamente.
- `/doctor` agora inclui seção de scheduler governance (owner/policy/conflict signal).

---

## B) Matriz de overlap (owner proposto + ação)

| Capability | Pacotes envolvidos | Evidência concreta | Risco | Owner proposto | Ação |
|---|---|---|---|---|---|
| Scheduler ownership/lease | `@ifi/oh-pi-extensions` + `@aretw0/pi-stack` | `scheduler.ts` (`handleStartupOwnership`, `takeOverScheduler`, `disableForeignTasks`, `clearForeignTasks`); lease em `scheduler-shared.ts` | **Alto** | `@aretw0/pi-stack/scheduler-governance` (policy), `oh-pi` (engine) | **Consolidar** (policy first-party, engine third-party) |
| Runtime doctor global | `environment-doctor` + checks de terceiros | `packages/pi-stack/extensions/environment-doctor.ts`; conflitos runtime detectados por lease | Médio | `environment-doctor` | **Manter** |
| Guard rails de tool-call | `guardrails-core` + `safe-guard` | ambos usam `pi.on("tool_call")` | Médio | `guardrails-core` para política stack | **Filtrar por policy** (não remover abrupto) |
| Monitor governance | `pi-behavior-monitors` + `monitor-provider-patch` | patch provider-aware e `/monitor-provider` no pi-stack | Médio | `monitor-provider-patch` (governança), davidorex (engine) | **Consolidar** |
| Colony governance | `oh-pi-ant-colony` + `colony-pilot` | `ant_colony` tool em third-party; policy/preflight/model em first-party | Médio | `colony-pilot` | **Consolidar** |
| Quota/consumo | `oh-pi-extensions/usage-tracker`, `mitsupi`, `quota-visibility` | docs + comando `/quota-visibility` first-party | Baixo/Médio | `quota-visibility` para camada operacional | **Coexistir** com fronteira explícita |
| Web browser/search/research | `web-skills`, `pi-web-access`, `oh-pi-skills`, `mitsupi` | `docs/research/overlap-matrix.md`, `install.mjs` filtros | Médio | `@aretw0/web-skills` (policy) | **Filtrar + migrar gradual** |

---

## C) Decisões arquiteturais (ADR-like)

### ADR-001 — Source of Truth por capability
- Toda capability crítica deve declarar owner primário.
- Secundários viram engines/adapters, não policy owners.

### ADR-002 — Segurança operacional > conveniência
- Default seguro: `observe`.
- Ação destrutiva requer confirmação textual forte.
- Non-interactive nunca executa destrutivo implicitamente.

### ADR-003 — Engine vs Policy split
- Engine pode continuar third-party (compatibilidade).
- Política operacional e governança ficam first-party.

### ADR-004 — Contrato mínimo para background extensions
Toda extensão de background deve expor:
1. Lease/heartbeat observável,
2. Status auditável por comando/tool,
3. Guardrails para destrutivo,
4. Fallback determinístico (observe/review).

### ADR-005 — Consolidar antes de expandir
- Nova extensão só entra se não duplicar policy existente.
- Se duplicar sem ganho comprovado → bloqueio de entrada.

---

## D) Backlog priorizado (P0/P1/P2)

### P0 (imediato)
1. **Scheduler governance first-party** (feito)
   - esforço: M
   - risco: baixo (sem breaking abrupto)
2. **Doctor hook de conflito de scheduler** (feito)
   - esforço: P
   - risco: baixo
3. **Runbook + guia operacional + checklist de admissão** (feito)
   - esforço: P
   - risco: baixo

### P1 (próxima iteração)
1. **Registry de capability owners em arquivo versionado** (`docs/architecture/capability-owners.json`)
2. **Regras de filtro por profile de instalação** (safe/minimal/full)
3. **Painel único de conflitos runtime** (`/stack-status`)

### P2 (médio prazo)
1. **A/B contínuo com e sem third-party concorrente** por capability crítica
2. **Métricas de previsibilidade operacional** (MTTR incidentes de ownership, takeover rate)
3. **Migração de engines críticas para first-party quando ROI comprovado**

---

## E) Plano de rollout + critérios de sucesso

### Rollout
1. Flag + default `observe` (já ativo)
2. 1 semana em monitoramento passivo (`/scheduler-governance status`)
3. Enable guided `review` para equipes com alto churn
4. Permissão destrutiva restrita a maintainers
5. Revisão quinzenal de conflitos e tuning de policy

### Critérios de sucesso (aceite)
- [x] Capability crítica (scheduler) com owner definido.
- [x] Política default segura para sessão concorrente.
- [x] Destrutivo com confirmação explícita.
- [x] Comando/status rápido de diagnóstico (`/scheduler-governance status`, `/doctor`).
- [x] Documentação operacional pronta para times.

---

## F) Prompt/automação para auditoria periódica

Prompt base (semanal):

```text
Audite a stack instalada neste workspace e gere relatório de soberania:
1) inventário de commands/tools/hooks por pacote ativo,
2) colisões nominais,
3) overlaps semânticos por capability crítica,
4) conflitos de governança em runtime/background,
5) owner proposto por capability,
6) recomendações (manter/filtrar/migrar/consolidar) com risco e esforço.

Inclua evidências concretas: arquivo/função/comportamento observado.
No fim, gere backlog P0/P1/P2 com critérios de sucesso mensuráveis.
```

Automação implementada (CI):
- Gate estrito no job de smoke:
  - `pnpm run audit:sovereignty`
  - `pnpm run audit:sovereignty:diff`
- Job dedicado de visibilidade:
  - `Sovereignty Report`
  - gera `docs/architecture/stack-sovereignty-audit-latest.md`
  - publica artifact `stack-sovereignty-audit`
  - faz upsert de comentário no PR com marcador `<!-- stack-sovereignty-report -->`
