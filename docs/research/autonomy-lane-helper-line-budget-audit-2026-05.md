# Autonomy lane surface helpers line-budget audit — 2026-05

Status: audit local-safe, sem mudança de runtime  
Arquivo: `packages/pi-stack/extensions/guardrails-core-autonomy-lane-surface-helpers.ts`  
Linha atual: ~1194  
Regra: preservar política de protected-scope, seleção determinística e fail-closed behavior.

## Leitura executiva

`guardrails-core-autonomy-lane-surface-helpers.ts` virou uma superfície de agregação para readiness, seeding, influence windows, batch preview, selection fallback e auto-advance. O arquivo ainda é coeso por tema geral (autonomy lane), mas já está grande demais para evoluir com segurança.

A extração deve seguir famílias de pacote, não função por função. O maior risco é mudar sem querer a semântica de seleção local-safe/protected ou a regra de `dispatchAllowed=false`/`authorization=none` dos packets report-only.

## Famílias atuais

| Faixa aproximada | Família | Funções principais | Risco |
| --- | --- | --- | --- |
| 1-90 | Normalização e leitura JSON | `normalizeContextLevel`, `asBool`, `asNumber`, `readJsonRecord` | Baixo; pode virar `*-common.ts`. |
| 92-240 | Iteration reminder e chaining | `buildIterationReminder`, `readHandoffFreshnessSignal`, `resolveLocalSafeChainingDecision` | Médio; mexe em continuidade/handoff. |
| 241-394 | Task helpers e pause brief | `resolveFocusTaskIds`, `normalizeTaskId`, `findTaskById`, `toTaskMnemonic`, `buildAutonomyOperatorPauseBrief`, protected/risk/validation helpers | Médio; protected-scope classifier precisa ficar estável. |
| 395-673 | AFK material readiness/seeding | `buildAfkMaterialReadinessPacket`, seed templates, reseed justification/priority | Médio; report-only mas influencia fluxo AFK. |
| 674-852 | Influence assimilation | `buildAfkMaterialSeedPacket`, `buildInfluenceAssimilationWindowPacket` | Protected-adjacent; deve manter human decision requirement. |
| 853-1007 | Batch preview | `buildReadyQueuePreview`, slice validation/rollback, `buildAutonomyLaneBatchPreviewPacket` | Médio; bom candidato por ser coeso e testável. |
| 1008-1157 | Selection hard-intent/auto-advance snapshot | `resolveTaskSelection`, `buildAutoAdvanceHardIntentSnapshot` | Alto; fail-closed e protected/risk gates. |
| 1158-final | Readiness input assembly | `buildReadinessInput` | Baixo; pode virar common/composition helper. |

## Ordem de extração recomendada

### 1. `guardrails-core-autonomy-lane-common.ts`

**Mover:** normalizers, `normalizeTaskId`, `findTaskById`, `toTaskMnemonic`, `buildReadyQueuePreview`, talvez `buildReadinessInput`.  
**Por que primeiro:** baixo risco, reduz ruído e melhora imports.  
**Focal gate:** `autonomy-lane-surface.test.ts`, `autonomy-lane-readiness.test.ts`.

### 2. `guardrails-core-autonomy-lane-local-safety.ts`

**Mover:** `taskHasProtectedSignal`, `taskHasRiskSignal`, `taskValidationGateKnown`, `workspaceLooksClean`, `resolveAutoAdvanceFailClosedReasons`.  
**Por que:** separa a política local-safe/protected em uma superfície auditável.  
**Cuidado:** manter regexes e ordem de fail-closed exatamente iguais no primeiro commit.  
**Focal gate:** `autonomy-lane-surface.test.ts`, `autonomy-task-selector.test.ts`, tests de protected-scope report.

### 3. `guardrails-core-autonomy-lane-afk-material.ts`

**Mover:** `buildAfkMaterialReadinessPacket`, seed templates, reseed justification/priority, `buildAfkMaterialSeedPacket`.  
**Por que:** pacote funcional coeso e grande.  
**Cuidado:** não autorizar dispatch; manter `humanActionRequired` quando seed decision exige humano.  
**Focal gate:** testes de material readiness/seed dentro de `autonomy-lane-surface.test.ts`.

### 4. `guardrails-core-autonomy-lane-influence.ts`

**Mover:** `buildInfluenceAssimilationWindowPacket`.  
**Por que:** protected-adjacent e conceitualmente separado de AFK material.  
**Cuidado:** preservar janela como report-only; não abrir external influence automaticamente.  
**Focal gate:** tests de influence assimilation packet.

### 5. `guardrails-core-autonomy-lane-batch-preview.ts`

**Mover:** `buildSliceValidationGate`, `buildSliceRollback`, `buildAutonomyLaneBatchPreviewPacket`.  
**Por que:** coeso e pode evoluir para batch runway sem tocar selection principal.  
**Cuidado:** manter rollback hints e validation-known requirement.  
**Focal gate:** batch preview tests.

### 6. `guardrails-core-autonomy-lane-hard-intent.ts`

**Mover:** `resolveTaskSelection`, `buildAutoAdvanceHardIntentSnapshot`.  
**Por que por último:** maior risco; mexe em successor selection e fail-closed hard intent.  
**Cuidado:** antes de mover, adicionar teste que bloqueia protected/risk/dirty/validation-unknown sucessor.  
**Focal gate:** `autonomy-task-selector.test.ts`, auto-advance telemetry tests, autonomy lane surface hard-intent tests.

## Política de proteção que deve permanecer invariável

- `include_protected_scopes` default continua falso.
- `taskHasProtectedSignal` continua bloqueando `.github/`, `.obsidian/`, `.pi/settings.json`, GitHub Actions, remote, publish, URLs e CI.
- `taskHasRiskSignal` continua tratando protected como risk.
- `workspaceLooksClean` continua fail-closed quando snapshot falha.
- Packets continuam `dispatchAllowed=false`, `mutationAllowed=false`, `authorization="none"`.
- Influence assimilation continua apenas janela/packet; não autoriza assimilação externa.
- Auto-advance hard intent continua fail-closed em protected/risk/dirty/validation-unknown.

## Testes focais por onda

```bash
pnpm vitest --run packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts packages/pi-stack/test/smoke/autonomy-task-selector.test.ts packages/pi-stack/test/smoke/autonomy-lane-readiness.test.ts
```

Adicionar conforme extração:

| Extração | Testes adicionais |
| --- | --- |
| Local safety helpers | protected-scope report tests em `autonomy-lane-surface.test.ts`. |
| AFK material | material readiness/seed packet tests. |
| Influence | influence assimilation packet tests. |
| Batch preview | batch preview tests e rollback/validation cue assertions. |
| Hard intent | `auto_advance_hard_intent_telemetry` e successor fail-closed tests. |

## Tamanho-alvo

A extração em ondas deve mirar:

- helpers principal: <=500 linhas;
- common/local-safety: <=250 linhas cada;
- afk-material: <=350 linhas;
- batch-preview: <=250 linhas;
- hard-intent: <=250 linhas.

Isso deixa espaço para evolução sem voltar rapidamente ao limite de 1000 linhas.

## Rollback

Cada onda deve ser commit único, sem mudança semântica. Rollback: `git revert <commit>` e rerun dos testes focais. Se uma extração alterar qualquer summary/report output, incluir `operator-visible-output.test.ts`.

## Próxima fatia recomendada

Seguir para `TASK-BUD-876` antes de implementar extrações. Depois dos três audits (`guardrails-core`, autonomy helpers, monitor-provider-patch), escolher a menor implementação: provavelmente `autonomy-lane-common` ou `guardrails-core eventSurfaceRuntime factory`.
