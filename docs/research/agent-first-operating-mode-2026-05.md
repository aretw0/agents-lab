# Modo operacional agent-first — 2026-05

## Norte

O control plane deve trabalhar o mínimo possível. Seu papel é escolher foco, montar pacote, validar gates, observar execução, registrar evidência e decidir promoção/rollback. A execução de análise ou mudança deve ir para agentes sempre que a tarefa for local-safe e tiver escopo/validação claros.

## Crítica ao estado anterior

O caminho atual provou que provider-native workers funcionam, mas ainda é artesanal: o control plane monta comandos `pi --print ... @files ...` manualmente. Isso mantém o control plane como gargalo, aumenta risco de erro de argv, e limita a evolução para agentes mais autônomos.

## Atualização operacional — 2026-06-10

O caminho artesanal foi substituído, para canaries e workers bounded, pela camada headless agnóstica:

```bash
pnpm run agent-run:pi-driver -- --mode print-readonly --model provider/model --file README.md --prompt "Return PASS." --summary
```

Para execução real, o contrato exige aprovação estruturada explícita:

```bash
pnpm run agent-run:pi-driver -- --mode print-readonly --model provider/model --file README.md --prompt "Return PASS." --execute --approve --follow --build-outcome --summary
```

Agentes externos podem evitar remontagem manual de JSON usando o pacote completo. O payload builder emite `driverStepCall`, e o driver aceita esse envelope inteiro:

```bash
pnpm run agent-run:pi-driver-payload -- --mode print-readonly --model provider/model --file README.md --prompt "Return PASS." --execute --follow --build-outcome --operator-approval-file approval.json --pretty > driver-packet.json
pnpm run agent-run:driver-step -- --input driver-packet.json --cwd .
```

Quando a aprovação estruturada já existe em arquivo, use `--operator-approval-file` no `agent-run:pi-driver` ou no `agent-run:pi-driver-payload`; o pacote emitido preserva `operator_approval` no envelope e no `driverStepCall`.

Para runs de mutação, o outcome só deve ser promovido com evidência parent-side explícita. O driver aceita a mesma evidência que `agent_run_outcome_packet`:

```bash
pnpm run agent-run:pi-driver -- --mode print-readonly --model provider/model --file README.md --prompt "Apply the scoped change." --file-contract mutation --touched-file README.md --mutation-target-file README.md --marker acceptance=true --execute --approve --follow --build-outcome --summary
```

O mesmo conjunto de flags de evidência (`--touched-file`, `--mutation-target-file`, `--marker`) pode ser usado em `agent-run:pi-driver-payload`; elas são preservadas em `driverStepCall.params` para o outcome embutido.

Sem `--touched-file`/`--mutation-target-file`, mutation terminal fica `contractDecision=partial`, não `pass`.

Evidência já validada:

- `real-pi-print-readonly-readme-canary-20260609`: Pi local, `openai-codex/gpt-5.3-codex-spark`, read-only, `README.md`, `contractDecision=pass`.
- `real-next-slice-decoupling-scan-20260610`: worker real pequeno recomendou a correção `readTasks/readVerificationRows` fail-closed; a mudança entrou em commit e testes.
- `agent_run_driver_step_dispatch`, `agent-run:pi-driver` e `agent-run:pi-driver-payload`: preservam `file_contract`, `touched_files`, `marker_results` e `mutation_target_files` para materializar outcome embutido em `follow=true` + `build_outcome=true`; o pacote emitido pelo CLI pode ser entregue diretamente a `agent-run:driver-step`.
- Gate local da lane: `pnpm run test:agent-run:drivers` (ou `node --test scripts/test/agent-run-driver-step.test.mjs scripts/test/agent-run-pi-driver.test.mjs scripts/test/agent-run-pi-driver-payload.test.mjs` em ambientes onde `pnpm` tenta instalar dependências).

Regra atual: para tarefas local-safe pequenas, tentar primeiro um worker via `agent-run:pi-driver` com escopo mínimo. Se um worker com múltiplos arquivos der timeout sem saída, reduzir o escopo antes de retry; não promover timeout como evidência.

## Evidência de worker

Run read-only: `task-bud-1000-agent-first-invocation-design-review`.

Resultado: PASS. O worker comparou padrões de `pi-extension-subagents`, `pi-workflows`, `pi-jit-agents`, `oh-pi-ant-colony` e os surfaces atuais de `agent_run`.

Padrões recomendados pelo worker:

- Usar contrato tipado de invocação em vez de argv manual.
- Borrow do ant-colony: sessão/agente in-process quando possível, para reduzir overhead e melhorar streaming/observabilidade.
- Borrow do jit-agents: output estruturado/schema/phantom-tool quando a tarefa precisa de contrato forte.
- Preservar registry-before-start e outcome non-empty como hard contract.
- Detectar mismatch provider/model/escopo como falha de contrato.

## Papéis

### Control plane

- Seleciona tarefa e confirma que é local-safe.
- Resolve provider/budget/timeout/rollback/declared files.
- Cria `AgentInvocationSpec` ou pacote equivalente.
- Registra start/status/log/outcome.
- Valida saída, diff e teste focal.
- Faz commit apenas depois de revisão e validação.

### Worker

- Executa análise ou patch dentro do escopo declarado.
- Produz saída não vazia e estruturada quando solicitado.
- Não altera escopo, provider, ferramentas ou orçamento por conta própria.
- Declara riscos, validações e arquivos tocados.

## Economia de tokens para subagentes

Evidência manual atual: DashScope `qwen3-coder-plus` está em `Remaining 246,289 / Total 1,000,000`. Isso deve ser tratado como sinal de economia para qualquer worker Qwen.

Workers em `minimal-no-extensions` não herdam automaticamente todo o estado da arte do control plane. Eles herdam o que a spec/prompt carrega. Portanto, toda invocação deve carregar um contrato explícito de economia:

- usar apenas `declaredFiles` salvo expansão humana explícita;
- evitar broad scans, installs, chamadas remotas e releitura narrativa de contexto;
- limitar saída por `maxOutputLines` e preferir bullets curtos;
- pedir contexto faltante em vez de explorar fora do escopo;
- preservar `budgetEvidence` e evidência de quota no prompt do worker.

Influências Squeez/MDT já assimiladas entram aqui como regra prática: poda de gordura, leitura seletiva, saída curta, single-source/focal evidence e validação mínima suficiente. O uso intensivo de subagentes deve ficar bloqueado quando a spec não explicitar esse contrato.

Essa regra não é exclusiva de subagentes: a auditoria global em `docs/research/global-token-economy-audit-2026-05.md` define economia para control plane, workers, monitores, handoff, validação, docs e routing.

## Regra padrão

Toda tarefa local-safe deve tentar primeiro um pacote single-worker antes de implementação manual pelo control plane.

Exceções permitidas para implementação manual pelo control plane:

1. Infraestrutura de agentes/invocação/gates/rollback/validação.
2. Correção de falha explícita de worker quando o erro é pequeno e diagnosticado.
3. Tarefa protegida que não pode ser entregue a worker sem nova autorização.
4. Emergência operacional para preservar handoff, contexto ou integridade do repo.

## API mínima desejada

```ts
interface AgentInvocationSpec {
  runId: string;
  profile: "read-only-review" | "small-mutation" | "test-fix" | "research";
  goal: string;
  providerModelRef: string;
  cwd: string;
  declaredFiles: string[];
  tools: string[];
  timeoutMs: number;
  fileContract: "read-only" | "mutation";
  outputSchema?: string;
  validation?: string[];
  rollback?: string[];
  budgetEvidence: {
    decision: "ok" | "warn" | "blocked" | "unknown";
    source: "route-advisory" | "provider-budget-snapshot" | "manual" | "unknown";
    provider: string;
    generatedAtIso: string;
  };
  economy: {
    mode: "standard" | "conserve" | "critical";
    tokenBudgetEvidence: string;
    maxOutputLines: number;
    instructions: string[];
  };
}

interface AgentInvocationResult {
  runId: string;
  processState: "completed" | "failed" | "timed-out" | "aborted";
  contractDecision: "pass" | "fail" | "partial";
  outputBytes: number;
  touchedFiles: string[];
  unexpectedFiles: string[];
  durationMs: number;
  summary: string;
}
```

## Próxima fatia local-safe

Criar `TASK-BUD-1002`: uma primitiva report-only `agent_invocation_spec_packet` ou equivalente que gera a spec tipada e o preview de execução sem exigir que o control plane monte argv na unha.

Gates da fatia:

- Não executar processo.
- Não instalar dependências.
- Preservar confirmação humana para execução real.
- Cobrir perfis `read-only-review` e `small-mutation` em testes.
- Reusar budget evidence e declared-file attachment já existentes.

## Métrica de mix

A partir desta tarefa, registrar nos handoffs:

- `worker_planned`: pacote de worker preparado.
- `worker_executed`: worker realmente executado.
- `control_plane_manual_impl`: implementação feita diretamente pelo control plane.

Meta inicial: pelo menos uma execução worker para cada nova tarefa local-safe antes de qualquer implementação manual não-infra.
