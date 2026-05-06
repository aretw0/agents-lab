# monitor-provider-patch line-budget audit — 2026-05

Status: audit local-safe  
Arquivo: `packages/pi-stack/extensions/monitor-provider-patch.ts`  
Linha atual: ~1031  
Tarefa: `TASK-BUD-876`  
Regra: preservar semântica first-party de patch de monitores, advisory monitors e comandos explícitos.

## Leitura executiva

`monitor-provider-patch.ts` está acima do limite de watch e concentra três responsabilidades diferentes:

1. política/patch de arquivos `.pi/monitors/*`;
2. output e comando `/monitor-provider`;
3. orquestração de `session_start` para vários patches independentes.

O arquivo já tem um bom primeiro split em `monitor-provider-config.ts`, `monitor-provider-core.ts` e `monitor-provider-authorization-calibration.ts`. A próxima decomposição deve continuar nessa direção, extraindo famílias sem alterar semântica de startup, sem mexer em `node_modules` e sem transformar monitor feedback em autoridade operacional.

Durante o audit apareceu um bug local em `/monitor-provider status`: `buildStatusReport` referenciava constantes de config sem importá-las. Isso foi tratado separadamente em `TASK-BUD-880`; este documento mantém o plano de arquitetura de `TASK-BUD-876`.

## Famílias atuais

| Faixa aproximada | Família | Símbolos principais | Observação |
| --- | --- | --- | --- |
| 1-63 | Cabeçalho/imports/reexports | imports de config/core/autorização | Já evidencia split parcial, mas import core está em linha longa. |
| 64-186 | Hedge policy/context | `normalizeHedgeContext`, `ensureHedgeMonitorPolicy`, `ensureHedgeMonitorContext` | Coeso, bom candidato para módulo próprio. |
| 187-307 | Fragility classifier/pattern hygiene | `normalizeFragilityContext`, guards de empty-output, `ensureFragilityClassifierCalibration`, `ensureFragilityPatternHygiene` | Semântica calibrada por incidentes; extrair com testes antes/depois. |
| 308-370 | Instruction nudges | `ensureInstructionLine`, commit/work-quality calibration | Pequeno e coeso; pode juntar com calibration helpers. |
| 371-451 | Monitor issue schema templates | `schemaCompatibleMonitorIssueTemplate`, `ensureMonitorIssueWriteTemplateSchema` | Importante para schema `.project/issues.json`; manter campos obrigatórios. |
| 452-546 | Fragility monitor policy + hedge state read | `ensureFragilityMonitorPolicy`, `ensureFragilityMonitorContext`, `readHedgeMonitorState` | Parte de monitor policy; pode acompanhar hedge/fragility split. |
| 547-668 | Output/status formatting | `planSessionStartOutput`, `buildStatusReport` | UI/command output separado da mutação de arquivos. |
| 669-689 | Template snippet | `buildTemplateSnippet` | Config docs/output; bom candidato junto ao command surface. |
| 690-1031 | Extension surface/orchestration | default export, command handler, `session_start` hook | Maior bloco; deve virar coordenador fino depois das extrações. |

## Extrações recomendadas

### 1. `monitor-provider-monitor-policy.ts`

**Mover:**

- `HedgeMonitorPolicy`, `normalizeHedgeContext`, `ensureHedgeMonitorPolicy`, `ensureHedgeMonitorContext`;
- `FragilityMonitorPolicy`, `normalizeFragilityContext`, `ensureFragilityMonitorPolicy`, `ensureFragilityMonitorContext`;
- `readHedgeMonitorState` se continuar usado apenas por status.

**Por que primeiro:** reduz o bloco de mutação de `.pi/monitors/*` sem tocar command handler nem model routing.  
**Cuidado:** preservar defaults `DEFAULT_HEDGE_WHEN`, `DEFAULT_FRAGILITY_WHEN`, remoção de `tool_results` e opt-in de `conversation_history`/project context.

### 2. `monitor-provider-calibration.ts`

**Mover:**

- guard lines de fragility empty-output;
- `ensureFragilityClassifierCalibration`;
- `ensureFragilityPatternHygiene`;
- `ensureInstructionLine`, `ensureCommitHygieneInstructionCalibration`, `ensureWorkQualityInstructionCalibration`.

**Por que:** agrupa calibrações versionadas que refletem aprendizados de monitor behavior.  
**Cuidado:** `.pi/monitors/*` é ignorado por git, então o valor durável é continuar com as linhas em código versionado/testado.

### 3. `monitor-provider-issue-template.ts`

**Mover:**

- `MONITOR_ISSUE_WRITERS`, `MONITOR_ISSUE_PRIORITY`;
- `schemaCompatibleMonitorIssueTemplate`;
- `ensureMonitorIssueWriteTemplateSchema`.

**Por que:** isolado e sensível a schema.  
**Cuidado:** manter campos obrigatórios de `.project/issues.json`: `title`, `body`, `location`, `status`, `category`, `priority`, `package`, `source`.

### 4. `monitor-provider-output.ts`

**Mover:**

- `planSessionStartOutput`;
- `buildStatusReport`;
- `buildTemplateSnippet`.

**Por que:** separa output/operator surface de escrita em arquivos.  
**Cuidado:** `buildStatusReport` precisa importar explicitamente settings/default-map do config; não depender de símbolos incidentais.

### 5. `monitor-provider-session-start.ts`

**Mover:**

- montagem dos patch results;
- geração de `details`;
- cálculo de `requiresReload`;
- severidade/warnings.

**Por que por último:** é o coordenador mais sensível. Após extrair famílias, o default export deve ficar fino: registrar comando e chamar `runMonitorProviderSessionStart(ctx)`.

## Invariantes que não podem mudar

- Não mutar `node_modules`.
- Não transformar monitor finding em decisão operacional; monitor continua advisory.
- `apply` continua comando explícito e pode sugerir `/reload`, mas não deve executar reload automaticamente.
- `session_start` pode sincronizar arquivos first-party `.pi/agents`/`.pi/monitors` conforme política existente, mas deve manter output compacto via `planSessionStartOutput`.
- Existing overrides não devem ser sobrescritos por `ensureOverrides`; divergência deve virar warning/instrução explícita `/monitor-provider apply`.
- Hedge continua lean por default; `conversation_history` e project context continuam opt-in.
- Fragility continua sem `tool_results` no contexto e com guardrails anti empty-output false positive.
- Issue template schema continua compatível com `.project/issues.json`.

## Testes focais

```bash
node --test packages/pi-stack/test/monitor-provider-patch.test.mjs
pnpm vitest --run packages/pi-stack/test/smoke/monitor-provider-authorization-calibration.test.ts packages/pi-stack/test/smoke/monitor-runtime-contract.test.ts
```

Para extração de output/status, adicionar/verificar teste específico para `/monitor-provider status` ou `buildStatusReport`, cobrindo:

- defaultProvider ausente;
- provider resolvido por default map;
- overrides divergentes;
- hedge monitor state.

## Tamanho-alvo

Após as ondas:

- `monitor-provider-patch.ts`: <=250 linhas, apenas extension surface e wiring;
- `monitor-provider-monitor-policy.ts`: <=250 linhas;
- `monitor-provider-calibration.ts`: <=250 linhas;
- `monitor-provider-issue-template.ts`: <=140 linhas;
- `monitor-provider-output.ts`: <=220 linhas;
- `monitor-provider-session-start.ts`: <=260 linhas.

A meta deixa cada superfície abaixo do limite de 1000 linhas e facilita auditoria de protected/advisory semantics.

## Rollback

Cada extração deve ser commit único, sem alteração semântica. Rollback padrão: `git revert <commit>` e rerun dos testes focais. Se a extração mexer em output de comando, validar também manualmente ou por teste o caminho `/monitor-provider status`.

## Próxima fatia recomendada

Antes de implementar decomposição, completar `TASK-BUD-877` e `TASK-BUD-878` para fechar o mapa de runway. Quando entrar em implementação, a menor fatia segura é `monitor-provider-issue-template.ts`, porque tem fronteira pequena e contrato de schema claro. A segunda melhor é `monitor-provider-output.ts`, mas ela deve incluir teste para `buildStatusReport` para evitar regressão semelhante à falta de imports.
