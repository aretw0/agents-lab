# Agent run semantic consolidation — 2026-05

## Decisão curta

Use **agent run** para a família de primitives que controla uma execução concreta de worker/subagente: plan, registry, status, log tail, outcome e abort.

Não usar `simple` como qualidade pública dessa família. Não usar `one-slice` no namespace público; o limite de uma execução deve aparecer como contrato (`singleRunOnly`, declared files, timeout, abort, validation), não como jargão do nome.

## Por que `agent run`

`agent run` descreve o objeto operacional real: uma execução registrada, observável e abortável. Isso encaixa melhor com:

- `runId`, `pid`, `state`, `logPath` e `statusPath`;
- outcome pós-processo (`processState` separado de `contractDecision`);
- registro local em `.pi/reports/agent-runs.json`;
- futura comparação entre providers sem criar outra família conceitual.

`local slice` nomeia a unidade local de continuidade sem sugerir subagente; `singleSliceOnly` expressa a regra de parada. `simple` é ambíguo: pode sugerir simplicidade de implementação, baixa criticidade ou baixa governança, quando o contrato real é **bounded single-agent run**.

## Inventário bounded

Com grep bounded em `packages/pi-stack/extensions`, `docs/primitives` e `docs/research` após a renomeação da família agent-run:

- O adjetivo `simple` foi identificado como ambíguo na runway de delegation.
- `one-slice` foi removido de namespaces públicos de runtime; o contrato de parada agora aparece como `singleSliceOnly`.

Classificação atual:

1. **Família agent-run recém-consolidada** — deve ficar sem `simple`/`one-slice` no namespace público. Feito em `TASK-BUD-973`.
2. **Continuidade local / canary de uma fatia** — usar `local slice` para a unidade de trabalho e `singleSliceOnly` para o limite de repetição. Feito em `TASK-BUD-984`.
3. **Delegation runway/rehearsal** — usar `delegate` como opção de decisão e `delegation_rehearsal_*` como packet report-only quando o foco é preparar uma delegação humana.

## Regra de nomenclatura daqui para frente

- **agent run**: execução concreta de worker, com registry/status/log/outcome/abort.
- **local slice**: fatia de trabalho executada pelo control-plane local, sem implicar subagente.
- **delegation runway**: decisão de quando delegar ou executar localmente; evitar novos nomes `simple-*`.
- **singleSliceOnly**: contrato explícito de parada/repetição; não usar como prefixo de novas tools.

## Plano sem overlap

1. Não criar aliases `one_slice_agent_run_*` para `agent_run_*`; aliases aumentariam a duplicidade que queremos evitar.
2. Não criar novos nomes `simple-*`; quando a superfície estiver em lapidação, renomear direto para a forma coesa.
3. Em novas docs, preferir `agent run` ou `local slice` conforme o executor real e explicar limites via campos de contrato, não via novo termo.
4. Usar `delegation runway` para decisão e `delegation rehearsal` para packet report-only pré-dispatch.

## Evidência de validação

- `npx vitest run packages/pi-stack/test/smoke/guardrails-agent-spawn-readiness.test.ts` passou com 11 testes após `agent_run_*`.
- `git diff --check` passou.
- `line_budget_snapshot` ficou em `watch`, com `aboveExtract=0` e `aboveCritical=0`.
