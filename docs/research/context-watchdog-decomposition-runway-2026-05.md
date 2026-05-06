# context-watchdog decomposition runway — 2026-05

Status: audit local-safe, documentação apenas  
Tarefa: `TASK-BUD-877`  
Arquivos principais: `packages/pi-stack/extensions/context-watchdog*.ts`  
Regra: preservar API pública, reload/auto-resume semantics e graceful-stop-before-compact.

## Leitura executiva

A família `context-watchdog` já está bem mais modularizada que os outros watched files, mas `context-watchdog.ts` ainda tem ~999 linhas porque combina quatro papéis:

1. barrel público de exports/reexports;
2. runtime state e event wiring (`session_start`, `input`, `message_end`);
3. loop `run()` com checkpoint/compact/steering/anti-paralysis logic;
4. montagem do runtime adapter para `context-watchdog-status-surface.ts`.

A decomposição precisa ser API-first: o arquivo `context-watchdog-public-api.ts` citado em research anterior não existe no tree atual; na prática, `context-watchdog.ts` é o barrel público consumido pelos testes. Qualquer extração deve manter os reexports estáveis ou introduzir um barrel explícito antes de mover lógica.

## Inventário de tamanho

| Arquivo | Linhas | Observação |
| --- | ---: | --- |
| `context-watchdog.ts` | ~999 | Barrel + runtime loop + extension wiring; foco principal. |
| `context-watchdog-handoff.ts` | ~659 | Handoff/autoresume prompt/budget; watch, mas coeso. |
| `context-watchdog-status-surface.ts` | ~650 | Tool/status surface; grande, mas já isolado. |
| `context-watchdog-continuation.ts` | ~637 | Continuation/readiness packets; grande, report-only. |
| `context-watchdog-continuation-surface.ts` | ~515 | Tool registration for continuation surfaces. |
| `context-watchdog-operator-signals.ts` | ~463 | Steering/operator signal policy; coeso. |
| `context-watchdog-progress-signals.ts` | ~405 | Progress/calm-close signals; coeso. |
| Restante | <=312 | Já abaixo de watch; manter como está salvo pressão específica. |

## Decomposição segura de `context-watchdog.ts`

### 1. `context-watchdog-public-api.ts` ou `context-watchdog-exports.ts`

**Mover primeiro:** apenas os blocos de `export`/`export type`, sem mover implementação.  
**Objetivo:** transformar `context-watchdog.ts` em `export * from "./context-watchdog-public-api"` para estabilizar contrato antes de tocar runtime.  
**Cuidado:** os testes importam muitos símbolos de `../../extensions/context-watchdog`; o caminho público deve continuar igual.

Aceitação mínima:

- nenhuma mudança semântica;
- `context-watchdog.test.ts` continua importando pelo mesmo caminho;
- novo arquivo concentra só reexports, sem runtime side effects.

### 2. `context-watchdog-runtime-factory.ts`

**Mover:** estado mutable e closures auxiliares de runtime:

- `lastAssessment`, `lastAnnouncedLevel`, `lastAutoCheckpointAt`, `lastAutoCompactAt`, `lastAutoResumeAt`;
- retry timer state;
- announcement/timeout pressure windows;
- `isReloadRequiredForSourceUpdate`, `clearAutoCompactRetryTimer`, `scheduleAutoCompactRetry`.

**Objetivo:** criar `createContextWatchdogRuntime(pi, initialConfig)` ou objeto similar, mas sem mudar surface registrada.  
**Cuidado:** timers e `ctx` continuam locais; não introduzir scheduler externo nem auto-dispatch novo.

### 3. `context-watchdog-run-loop.ts`

**Mover:** corpo de `run(ctx, reason)` depois que o estado estiver encapsulado.  
**Objetivo:** isolar avaliação/checkpoint/compact/steering em uma função testável por state adapter.  
**Cuidado:** manter ordem atual:

1. build assessment;
2. post-reload auto-resume handling;
3. status update;
4. auto-checkpoint;
5. compact diagnostics/defer/calm-close;
6. auto-compact guard/checkpoint gate;
7. steering/final-turn signal.

Alterar essa ordem pode quebrar graceful stop, checkpoint freshness ou auto-resume.

### 4. `context-watchdog-status-runtime-adapter.ts`

**Mover:** montagem de `statusRuntime` no fim do arquivo.  
**Objetivo:** deixar `context-watchdog.ts` só registrando eventos + status surface.  
**Cuidado:** preservar métodos usados por `context-watchdog-status-surface.ts`, principalmente getters de compact state e `applyPreset`.

### 5. Depois, avaliar arquivos já grandes

Após reduzir `context-watchdog.ts`, só então considerar:

- `context-watchdog-status-surface.ts`: separar `currentAutoCompactState` de tool registration;
- `context-watchdog-continuation.ts`: separar turn-boundary/growth snapshot de one-slice preview summaries;
- `context-watchdog-handoff.ts`: separar prompt compaction/budget helpers de freshness/reconciliation helpers.

Essas extrações são secundárias; o maior risco atual é o barrel/runtime misturado em `context-watchdog.ts`.

## API pública sensível

`packages/pi-stack/test/smoke/context-watchdog.test.ts` importa diretamente dezenas de símbolos de `../../extensions/context-watchdog`, incluindo:

- config/bootstrap: `normalizeContextWatchdogConfig`, `buildContextWatchBootstrapPlan`, `applyContextWatchBootstrapToSettings`;
- handoff/resume: `buildAutoResumePromptFromHandoff`, `resolveHandoffFreshness`, `withAutoResumeAfterReloadIntent`;
- auto-compact: `buildAutoCompactDiagnostics`, `shouldTriggerAutoCompact`, `resolveAutoCompactCheckpointGate`;
- steering/operator/progress: `resolveContextWatchOperatorSignal`, `resolvePreCompactCalmCloseSignal`, `resolveAntiParalysisDispatch`;
- report-only summaries: `formatContextWatchAutoResumePreviewSummary`, `formatContextWatchContinuationReadinessSummary`, `formatContextWatchOneSliceOperatorPacketPreviewSummary`.

Por isso, a primeira extração deve ser reexport-only. Não mover implementação e imports ao mesmo tempo.

## Invariantes que não podem mudar

- `warn` continua steering, não soft-stop automático.
- `checkpoint` continua graceful-stop window; salvar handoff/checkpoint antes de compactar.
- `compact` continua force/auto-compact apenas quando gates permitem.
- Auto-compact precisa respeitar idle, pending messages, checkpoint evidence, cooldown e timeout-pressure guard.
- Auto-resume depois de compact/reload continua gated por checkpoint freshness, reloadRequired e cooldown.
- `context_watch_checkpoint` continua bounded e deve manter orçamento de handoff.
- Ferramentas report-only continuam sem dispatch/mutation implícita, salvo ferramentas explicitamente mutativas já existentes (`checkpoint`, `bootstrap apply`) e sob contrato atual.
- Nenhuma extração deve pedir protected-scope, scheduler externo, remote/offload ou GitHub Actions.

## Testes focais

```bash
pnpm vitest --run packages/pi-stack/test/smoke/context-watchdog.test.ts packages/pi-stack/test/smoke/context-watchdog-continuation.test.ts packages/pi-stack/test/smoke/context-watchdog-checkpoint.test.ts packages/pi-stack/test/smoke/context-watchdog-resume.test.ts packages/pi-stack/test/smoke/context-watchdog-post-reload.test.ts
```

Para a primeira onda `public-api/exports`, exigir também:

```bash
pnpm vitest --run packages/pi-stack/test/smoke/manifest-integrity.test.ts packages/pi-stack/test/smoke/package-list.test.ts
```

## Tamanho-alvo

Meta após ondas:

- `context-watchdog.ts`: <=300 linhas;
- `context-watchdog-public-api.ts`: <=220 linhas, reexports only;
- `context-watchdog-runtime-factory.ts`: <=300 linhas;
- `context-watchdog-run-loop.ts`: <=450 linhas;
- `context-watchdog-status-runtime-adapter.ts`: <=180 linhas.

Os arquivos já grandes (`handoff`, `status-surface`, `continuation`) podem ficar em watch até a extração principal estabilizar.

## Rollback

Cada onda deve ser reversível por commit único. Para a primeira onda:

1. criar `context-watchdog-public-api.ts` com reexports;
2. trocar reexports em `context-watchdog.ts` por barrel local;
3. rodar testes focais;
4. commit único.

Rollback: `git revert <commit>`. Não fazer reorder do loop `run()` no mesmo commit de reexport.

## Próxima fatia recomendada

Completar `TASK-BUD-878` antes de implementar. Quando implementar, começar por `context-watchdog-public-api.ts` reexport-only. Só depois encapsular state/runtime. Essa ordem reduz risco de quebrar imports públicos e evita repetir o rollback amplo que já ocorreu em tentativa anterior de public API extraction.
