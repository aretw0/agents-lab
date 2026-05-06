# `guardrails-core.ts` line-budget audit — 2026-05

Status: audit local-safe, sem mudança de runtime  
Arquivo: `packages/pi-stack/extensions/guardrails-core.ts`  
Linha atual: ~1396  
Budget atual em teste: `MAX_ORCHESTRATOR_LINES = 1400` em `guardrails-core-orchestrator-budget.test.ts`

## Leitura executiva

`guardrails-core.ts` já é majoritariamente um orquestrador, mas ainda carrega lógica runtime suficiente para ficar no limite do orçamento. A prioridade não é uma extração grande; é reduzir o arquivo sem mexer em comportamento público, mantendo o arquivo como wiring/registration e movendo apenas blocos coesos com testes existentes.

A meta de médio prazo é **<=1000 linhas por superfície TS**. Para este arquivo, o caminho seguro é uma sequência de extrações pequenas, cada uma com teste focal e rollback direto.

## Responsabilidades atuais

| Faixa aproximada | Responsabilidade | Risco |
| --- | --- | --- |
| 1-230 | Imports, re-exports e tipos/configs agregados | Public-API-sensitive: exports de `guardrails-core` são consumidos por testes e outras surfaces. |
| 247-330 | Estado runtime da extensão e defaults de sessão | Runtime-sensitive: timers, lease, queue, budget, bloat e i18n state. |
| 332-600 | Helpers de heartbeat/evidence/lease/failure tracking | Local-safe extraível se movido como runtime helper com interface explícita. |
| 600-1060 | `tryAutoDrainDeferredIntent` com auto-drain, board auto-advance, retry e failure tracking | Mais arriscado; toca loop/autonomy dispatch. Extrair só depois de snapshot/regression dedicado. |
| 1095-1185 | `session_start` reset/config/status setup | Extraível como session lifecycle helper, mas precisa preservar reset order. |
| 1187-1205 | `eventSurfaceRuntime` adapter | Bom candidato para factory tipada; baixo impacto se contrato for preservado. |
| 1207-1313 | `tool_call` guard para read/bash/edit/write | Runtime guard crítico; extrair por policy family, não como rewrite amplo. |
| 1315-1368 | Surface registrations e lane queue runtime adapter | Deve permanecer legível no orquestrador; pode ser agrupado em registrar helper se teste garantir wiring. |
| 1370-final | `agent_end` cleanup | Pequeno; só extrair junto com lifecycle se necessário. |

## Seams recomendados

### 1. `guardrails-core-runtime-snapshot.ts` ou helper equivalente

**Mover:** factory para `eventSurfaceRuntime` e talvez tipos mínimos do adapter.  
**Por que primeiro:** bloco pequeno, coeso e testável por string/registration existente.  
**Cuidado:** manter `registerGuardrailsCoreEventSurface(pi, eventSurfaceRuntime)` visível ou ajustar `guardrails-core-orchestrator-budget.test.ts`.  
**Ganho estimado:** 30-60 linhas.

### 2. `guardrails-core-session-lifecycle.ts`

**Mover:** reset de `session_start`, status cleanup e leitura de configs para helper que recebe getters/setters ou um objeto mutable runtime.  
**Por que:** separa boot/reset de registration.  
**Cuidado:** ordem de reset importa: timers, cache de budget, loop runtime, evidence heartbeat e statuses.  
**Ganho estimado:** 80-120 linhas.

### 3. `guardrails-core-loop-runtime-adapter.ts`

**Mover:** helpers de heartbeat/evidence/lease/failure tracking que hoje ficam entre o estado e `tryAutoDrainDeferredIntent`.  
**Por que:** muita lógica já delega para helpers importados; falta um adapter coeso para estado mutable.  
**Cuidado:** não misturar com auto-dispatch; começar por wrappers puros/pequenos.  
**Ganho estimado:** 120-180 linhas.

### 4. `guardrails-core-tool-call-guard.ts`

**Mover:** `tool_call` handler para read/bash/edit/write guard, recebendo configs e runtime bloat adapter.  
**Por que:** bloco crítico mas bem delimitado por evento.  
**Cuidado:** preservar ordem dos bloqueios: read path -> shell routing -> bash policies -> strict interactive -> port conflict -> bash path reads -> upstream package mutation -> structured-first -> bloat smell.  
**Ganho estimado:** 100-150 linhas.

### 5. `guardrails-core-auto-drain-runtime.ts` somente depois

**Mover:** `tryAutoDrainDeferredIntent`.  
**Por que depois:** é o bloco mais complexo e toca board auto-advance/queue/retry/failure.  
**Cuidado:** criar teste de regression antes; não extrair no mesmo commit do lifecycle/tool-call.  
**Ganho estimado:** 450-520 linhas, mas maior risco.

## Ordem proposta de execução

1. **Plan/test guard:** reforçar `guardrails-core-orchestrator-budget.test.ts` se a extração mudar strings de wiring.
2. **Small factory:** extrair `eventSurfaceRuntime` factory.
3. **Lifecycle helper:** extrair `session_start` e `agent_end` cleanup com teste de status/reset básico.
4. **Tool-call handler:** extrair guard order com testes existentes de shell/path/structured-first/bloat.
5. **Loop adapter:** extrair heartbeat/lease/failure wrappers.
6. **Auto-drain:** só com fixture ou smoke dedicado para board auto-advance/deferred queue.
7. **Ratchet:** reduzir `MAX_ORCHESTRATOR_LINES` de 1400 para 1300, depois 1200, depois <=1000 conforme extrações passarem.

## Focal gates

Mínimo para qualquer extração neste arquivo:

```bash
pnpm vitest --run packages/pi-stack/test/smoke/guardrails-core-orchestrator-budget.test.ts
```

Adicionar conforme seam tocado:

| Seam | Testes focais |
| --- | --- |
| Surface wiring | `guardrails-core-orchestrator-budget.test.ts`, `manifest-integrity.test.ts` se registration/export mudar. |
| Event surface runtime | `guardrails-human-confirmation-runtime-wiring.test.ts`, testes de bloat/event-surface relacionados. |
| Session lifecycle | `guardrails-long-run-intent-queue.test.ts`, `guardrails-loop-heartbeat-helper.test.ts`, status/runtime config smoke. |
| Tool-call guard | `guardrails-shell-route-registration.test.ts`, `guardrails-bash-guard-policies.test.ts`, `guardrails-structured-first.test.ts`, path/structured-io smoke relevante. |
| Auto-drain | `guardrails-long-run-intent-queue.test.ts`, `autonomy-task-selector.test.ts`, board auto-advance telemetry tests. |

## Protected/public-API-sensitive limites

- Não reescrever exports agregados de `guardrails-core` sem teste de reexport.
- Não mexer em `context-watchdog-public-api.ts` nesta trilha.
- Não alterar provider budget governor behavior no mesmo commit de line-budget.
- Não alterar semântica de `sendUserMessage`/auto-advance/queue sem teste específico.
- Não misturar extração com novos tools, novos comandos ou protected-scope expansion.

## Rollback padrão

Cada extração deve caber em um commit pequeno. Rollback esperado: `git revert <commit>` e rerun do teste focal. Se mexer em runtime loop, checkpoint/handoff deve ser escrito antes da fatia seguinte.

## Próxima fatia recomendada

Depois deste audit, seguir para `TASK-BUD-875` (autonomy lane helper audit). Para `guardrails-core.ts`, a primeira implementação futura mais segura é extrair uma factory pequena do `eventSurfaceRuntime` ou um helper de lifecycle, não o auto-drain inteiro.
