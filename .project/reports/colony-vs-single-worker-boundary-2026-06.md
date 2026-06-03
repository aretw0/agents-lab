# Contrato de fronteira: @ifi/oh-pi-ant-colony vs lane first-party single-worker (2026-06)

**Escopo:** separar evidência e decisão entre execução em runtime externo (`@ifi/oh-pi-ant-colony`) e evolução local-safe em single-worker first-party.
**Base de evidência:**
- `.project/reports/TASK-BUD-521-executor-propagation-gap.md`
- `packages/pi-stack/extensions/colony-pilot.ts`
- `packages/pi-stack/test/smoke/colony-pilot-model-propagation-contract.test.ts`
- `docs/research/agent-runner-maturity-checkpoint-2026-05.md`
- `docs/research/agent-first-operating-mode-2026-05.md`

## 1) Contrato mínimo esperado de `@ifi/oh-pi-ant-colony`

### Inputs explícitos (caller side)

1. **`ant_colony` tool call** recebe `goal` + overrides opcionais.
2. **Para validação de propagação de modelo, o mínimo observável passa a ser:**
   - `scoutModel`
   - `workerModel`
   - `soldierModel`
3. **Campos auxiliares aceitos para extensão futura:**
   - `designWorkerModel`
   - `multimodalWorkerModel`
   - `backendWorkerModel`
   - `reviewWorkerModel`
4. `colonyPilot` já coleta estes campos em `collectExplicitModelOverrides` e cria contrato de propagação por `goal`.

### state.json esperado (runtime)

Para cada execução rastreada, o runtime deve produzir `state.json` em mirror de ant-colony de `colony-pilot` (ex.: `.../ant-colony/**/workspaces/<cwd>/colonies/<colonyId>/state.json`):

- **Aceitação canônica atual em `colony-pilot`:**
  - `modelOverrides` (objeto) com chaves equivalentes aos papéis e valores `provider/model`.
  - ou, em fallback, `ants` com itens `[{ caste, model }]` onde `caste` mapeia para os papéis.

- **Mapeamento canônico de roles:**
  - `scoutModel` ↔ `scout`
  - `workerModel` ↔ `worker`
  - `soldierModel` ↔ `soldier`
  - (`designWorkerModel` ↔ `design`, `multimodalWorkerModel` ↔ `multimodal`, `backendWorkerModel` ↔ `backend`, `reviewWorkerModel` ↔ `review`)

- **Exemplo mínimo (estado compatível com contrato atual):**
  ```json
  {
    "modelOverrides": {
      "scoutModel": "openai-codex/scout-v1",
      "workerModel": "openai-codex/worker-v1",
      "soldierModel": "openai-codex/soldier-v1"
    },
    "ants": [
      { "caste": "scout", "model": "openai-codex/scout-v1" },
      { "caste": "worker", "model": "openai-codex/worker-v1" },
      { "caste": "soldier", "model": "openai-codex/soldier-v1" }
    ]
  }
  ```

### Sinais mínimos

O ciclo mínimo que `colony-pilot` usa para casar contrato é:

1. `COLONY_SIGNAL:LAUNCHED` com `colonyId` (e opcionalmente runtime id: `id|runtimeId`).
2. Sinais terminais (`COMPLETED`, `FAILED`, `ABORTED`, `BUDGET_EXCEEDED`).
3. Opcionalmente `SCOUTING`, `RUNNING`, `TASK_DONE` para estado de execução, sem exigir fechamento do contrato.
4. `colony-pilot` resolve state no launch/terminal com `buildAntColonyMirrorCandidates(...)` + `readColonyRuntimeState(...)`.

### Critérios PASS / FAIL (executáveis no stack)

- **PASS (contrato valido):**
  - Para cada papel explícito em `toolInput`, o `state.json` existe e contém o mesmo model no `modelOverrides` ou em `ants[].model`.
  - Não há divergência de texto no modelo por papel.

- **PASS parcial (comportamento já aceito pelo contrato atual):**
  - `modelOverrides` pode vir vazio, desde que `ants` cubra os papéis explicitamente esperados.

- **FAIL:**
  - Algum papel explícito esperado não encontrado no estado.
  - Divergência entre esperado e observado.
  - `state.json` não encontrado até sinal terminal (fail-closed):
    - mensagem emitida em `colony-pilot.model-propagation-contract`
    - warning UI e task block associada quando sync de projeto está ativo.

- **Estado atual detectado:**
  - `TASK-BUD-521` mostra `modelOverrides: {}` e apenas `ants` com scout/copilot, sem worker/soldier, gerando mismatch/estado não confiável para propagação explícita.

## 2) Lane first-party single-worker que já pode avançar sem `ant_colony`

### Primitivas a usar

1. **Runner single-worker (single `runId`) com confirmação humana por frase exata.**
2. **Contrato de execução do worker (declared scope):** `read-only` ou `mutation` restrito.
3. **Finalização obrigatória do processo:** `agent_run_follow`.
4. **Contrato de outcome:** `agent_run_outcome_packet` com validação de saída/touched files.
5. **Revisão da evidência no control plane:** validação de marcador/teste/arquivo e conclusão parent-side.

### Gates já existentes que validam essa lane

- Dispatch autorizado apenas por confirmação explícita (`humanConfirmationPhrase`) + `runId` atrelado.
- Processo terminal validado (`registry/status/follow`).
- Resultado validado com contrato (`agent_run_outcome_packet`: output, touched files, markers, touched-file mismatch).
- Bloqueio de alcance: não há “auto dispatch” sem autorização.
- Para mutação: política de escopo declarado e rollback/validação já definida no contrato da lane (ex.: one-file mutation comprovada).
- Evidência já disponível em marcos: `TASK-BUD-1018`, `TASK-BUD-1022`, `TASK-BUD-1024`, `TASK-BUD-1025`, `TASK-BUD-1066`, `TASK-BUD-1068`, `TASK-BUD-1075`.

### Riscos permanecem bloqueados na execução first-party single-worker

- Multi-worker (sem prova de contrato de coordenação).
- Dispatch de `ant_colony` sem correção de runtime.
- Escopo protegido/sensível sem autorização adicional.
- Execução broad/read-only sem declared files.
- Mutação multi-arquivo sem evidência de contrato completa.

### Próxima fatia de código local-safe (sem lançar colônia)

1. Criar/expandir pacote report-only de contrato para separar claramente os domínios:
   - seção de parser/contrato de runtime ant-colony (esperado de `state.json` + sinais)
   - seção de “caminho de sucesso” para single-worker first-party
2. Adicionar/fortalecer testes de não-regressão no próprio pacote smoke da lane runner (sem executar executor externo), cobrindo:
   - fail-closed sem `state.json` até terminal
   - mismatch explícito de modelo por papel
   - PASS quando `modelOverrides` ausente e `ants` está coerente
3. Registrar evidência de maturidade para decisão de próximo passo (sem mudança de estado de tasks nesta fatia).

## 3) Decisão operacional recomendada

- **Manter `colony` em `paused`.**
- **Permitir avanço da single-worker first-party como fábrica inicial** para revisão, validação de evidência e preparos locais (sem executar a colônia).
- **Destravar multi-worker/colony apenas após contrato runtime validado end-to-end** (`modelOverrides`/`ants` por papel persistidos corretamente e sinais mínimos observáveis até conclusão).

## Restrições preservadas

- Não editar `decision.md`.
- Não editar `.project/tasks.json`.
- Não marcar fechamento de task nesta rodada.
- Não lançar colônia/`ant_colony` nesta etapa.