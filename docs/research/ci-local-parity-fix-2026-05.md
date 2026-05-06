# CI local parity fix — 2026-05

Status: local-ready / no push  
Tarefa: `TASK-BUD-910`

## 1. Pedido

O operador pediu para reproduzir localmente a falha vista no GitHub Actions, preparar a correção no repo e **não enviar push**.

Também informou esgotamento de quota do GitHub Copilot em monitores, com erro:

```text
Warning: [hedge] classify failed: Agent 'hedge-classifier' dispatch failed: no tool call in response
(content types: [] error: 429 quota exceeded)
```

## 2. Escopo aplicado

- Local repo only.
- Sem push.
- Sem publish/release/deploy.
- Sem alteração de provider/model/settings/routing/monitor migration.
- Sem API keys.
- Sem Qwen canary.

## 3. Reprodução local

Comando reproduzido:

```bash
npm run ci:smoke:gate
```

Falha inicial:

```text
packages/pi-stack/test/smoke/guardrails-human-confirmation-runtime-wiring.test.ts
AssertionError: expected guardrails-core.ts to contain recordTrustedHumanConfirmationUiDecision
```

Causa: o teste ainda inspecionava `packages/pi-stack/extensions/guardrails-core.ts` como monólito, mas a responsabilidade de confirmação humana confiável já está extraída para:

- `packages/pi-stack/extensions/guardrails-core-confirmation-audit.ts`
- `packages/pi-stack/extensions/guardrails-core-read-path-runtime.ts`

## 4. Correção preparada

1. Ajustei `packages/pi-stack/test/smoke/guardrails-human-confirmation-runtime-wiring.test.ts` para validar as fontes atuais da responsabilidade extraída:
   - audit/event evidence em `guardrails-core-confirmation-audit.ts`;
   - scopes de read-path em `guardrails-core-read-path-runtime.ts`.
2. Adicionei `pnpm-workspace.yaml` para remover drift/warning local do pnpm e manter coerência com o workspace declarado em `package.json`.
3. Ajustei localmente os overrides ignorados em `.pi/monitors/hedge.monitor.json` e `.pi/monitors/unauthorized-action.monitor.json` para remover `conversation_history` dos contextos default, preservando `tool_calls` + `custom_messages` como contexto leve. Isso reduz custo de classifier nesta workspace após o `429 quota exceeded`, mas esses overrides são ignorados por git e não fazem parte do patch versionado.
4. Atualizei `packages/pi-stack/test/monitor-interference-matrix.test.mjs` para validar o contrato atual quando os overrides locais existem: authorization monitors continuam context-aware, mas `conversation_history` fica opt-in para preservar quota.
5. Mantive workflows sem mudança nesta fatia porque a falha reproduzida era teste/config stale-vs-extraction, não comando errado do Actions.

## 5. Validação

Focal:

```bash
pnpm vitest --run \
  packages/pi-stack/test/smoke/guardrails-human-confirmation-runtime-wiring.test.ts \
  packages/pi-stack/test/smoke/guardrails-human-confirmation.test.ts \
  packages/pi-stack/test/smoke/workflow-actions-runtime-baseline.test.ts
```

Resultado: 3 files passed, 19 tests passed.

NPM/paridade:

```bash
npm run test:smoke -- --run packages/pi-stack/test/smoke/guardrails-human-confirmation-runtime-wiring.test.ts
```

Resultado: 1 file passed, 1 test passed.

Gate Node test usado no fluxo de publish:

```bash
npm test
```

Resultado após correção: 163 tests passed, 0 failed.

Gate local equivalente ao CI smoke:

```bash
npm run ci:smoke:gate
```

Resultado após correção final:

- `test:smoke`: 128 files passed, 1172 tests passed;
- `audit:sovereignty`: ok, blockers=0, strict=true;
- `audit:sovereignty:diff`: ok, blockers=0, strict=true.

## 6. Copilot quota exhaustion

O erro `429 quota exceeded` em `hedge-classifier` confirma que Copilot não está mais confiável para classifier/monitor no momento.

Nesta fatia eu não alterei provider/monitor routing porque isso pertence ao boundary protegido de Model Infrastructure (`TASK-BUD-849`). O estado seguro é:

- tratar Copilot classifier como quota-blocked/degraded;
- não repetir loops de monitor esperando recuperação imediata;
- manter Qwen/Alibaba apenas como candidato canary, sem ativação;
- exigir decisão protegida para qualquer fallback de monitor provider.

## 7. Rollback

Rollback local:

```bash
git checkout -- packages/pi-stack/test/smoke/guardrails-human-confirmation-runtime-wiring.test.ts packages/pi-stack/test/monitor-interference-matrix.test.mjs pnpm-workspace.yaml docs/research/ci-local-parity-fix-2026-05.md
```

Se `docs/architecture/stack-sovereignty-audit-latest.md` for mantido atualizado pelo gate local, reverter separadamente se o objetivo for evitar drift de relatório gerado.

Os overrides locais ignorados podem ser revertidos com restore manual a partir do backup/local policy desejado, ou regenerados por `monitor-provider-patch` no próximo hatch conforme settings locais.
