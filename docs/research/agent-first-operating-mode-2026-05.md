# Modo operacional agent-first — 2026-05

## Norte

O control plane deve trabalhar o mínimo possível. Seu papel é escolher foco, montar pacote, validar gates, observar execução, registrar evidência e decidir promoção/rollback. A execução de análise ou mudança deve ir para agentes sempre que a tarefa for local-safe e tiver escopo/validação claros.

## Crítica ao estado anterior

O caminho atual provou que provider-native workers funcionam, mas ainda é artesanal: o control plane monta comandos `pi --print ... @files ...` manualmente. Isso mantém o control plane como gargalo, aumenta risco de erro de argv, e limita a evolução para agentes mais autônomos.

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
