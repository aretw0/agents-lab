# Primitiva de orquestração agêntica simples→complexa

> Naming update: o degrau L1 operacional foi consolidado como `agent run` / `agent_run_*`. Este documento mantém os nomes antigos (`simple`, `one_slice_agent_run_*`) como trilha histórica do cultivo; novas primitives não devem criar aliases para esses nomes.

## Incidente que motivou a primitiva

Durante o canary `provider-canary-spark`, a execução via `pi-workflows` ficou presa na etapa `implement` por mais de 10 minutos para uma tarefa docs-only. O operador precisou sair do pi inteiro para encerrar o processo.

Evidência local observada:

- O run persistiu apenas `spec.json` em `.workflows/runs/provider-canary-spark/...`.
- O artefato alvo `docs/research/provider-canary-scorecard-2026-05.md` não foi criado.
- O control-plane via ferramentas conseguia ver o spec e o estado de arquivos, mas não tinha heartbeat da chamada LLM, tool-call parcial, PID dedicado, timeout aplicado, nem abort seguro apenas do worker.

Conclusão: o runner atual serviu como descoberta, mas não é aceitável como executor principal de canaries agênticos sob governança.

## Princípio

Delegação agêntica precisa evoluir em degraus. Cada degrau só promove para o próximo depois de provar controle operacional: escopo declarado, processo observável, timeout, abort seguro, validação focal, rollback e checkpoint.

## Influências reaproveitadas (“roubar como artista”)

Esta primitiva não deve nascer do zero. Ela reaproveita padrões que já estamos curando em outras frentes:

- **Background process control**: registry, `pid`, owner/workspace/session, tail bounded, graceful stop then kill, cleanup em reload/handoff e lifecycle classificado antes de qualquer launch/stop operacional.
- **Agents-as-tools calibration**: separar calibração/readiness de dispatch, preservar `dispatchAllowed=false` nos packets e exigir boundedness/observability antes de promover execução.
- **OpenAI Symphony influence**: orquestrador como autoridade única, workspaces por item, status surface como observabilidade e não fonte de verdade, preflight por tick e reload fail-closed/last-known-good.
- **Incidente `provider-canary-spark`**: a UI enxergar “running” não basta; o parent precisa de estado queryável, log/status e abort seguro por run id.

## Escada de maturidade

### L0 — execução direta pelo control-plane

Uso: fatias pequenas onde o assistente principal lê, edita e valida diretamente.

Requisitos:

- arquivos declarados antes da edição;
- validação focal conhecida;
- rollback por diff/arquivo;
- sem subprocesso agêntico.

### L1 — one-shot agent subprocess controlado

Uso: primeiro degrau de delegação simples.

Contrato mínimo:

- exatamente um worker;
- `cwd` explícito;
- provider/model explícito;
- prompt e arquivo alvo registrados;
- timeout curto por padrão;
- PID/processo dedicado ou run id controlável;
- stdout/stderr capturados em log bounded;
- heartbeat ou timestamps de lifecycle;
- abort seguro sem derrubar a sessão pai;
- validação local feita pelo control-plane, não pelo worker;
- stop obrigatório após uma fatia.

Não promover se:

- o único jeito de parar for sair do pi inteiro;
- não houver evidência incremental além da TUI;
- não houver timeout/abort testado.

### L2 — workflow simples observável

Uso: encadear etapas pequenas quando L1 já está verde.

Requisitos adicionais:

- estado persistido por etapa;
- status queryável por ferramenta: run id, etapa, duração, provider/model, arquivo alvo, último evento;
- pause/abort por run id;
- distinção clara entre “chamada LLM em voo” e “checkpoint persistido”.

### L3 — background worker supervisionado

Uso: tarefas longas locais com processo em background.

Requisitos adicionais:

- registry de processos;
- port/lease quando aplicável;
- bounded log tail;
- graceful stop then kill;
- cleanup em reload/handoff;
- rollback conhecido;
- healthcheck quando houver servidor.

### L4 — swarm/colônia

Uso: paralelismo real e múltiplos agentes.

Requisitos adicionais:

- preflight de máquina/quota;
- isolamento por worktree;
- orçamento explícito;
- tarefas independentes;
- reviewers/quality gate;
- promoção manual dos resultados.

## Primitiva proposta: `one_slice_agent_run`

Forma: extensão/tool first-party, não apenas documentação.

Primeira fatia implementada após o incidente: `one_slice_agent_run_plan`, um packet report-only que não despacha, mas normaliza o contrato L1 antes de qualquer novo worker. Ele herda explicitamente os invariantes das primitivas acima: `activation=none`, `authorization=none`, `dispatchAllowed=false`, `executorApproved=false`, `requiresHumanDecision=true`.

Entrada mínima:

- `goal` ou `prompt`;
- `providerModelRef`;
- `cwd`;
- `declaredFiles`;
- `timeoutMs`;
- `validation`;
- `rollbackPlan`;
- `dryRun` default true.

Saída mínima:

- `decision`: `ready-to-run | blocked | completed | failed | timed-out | aborted`;
- `dispatchAllowed`: sempre false em preview; true apenas em execute explícito;
- `runId`;
- `pid` quando houver;
- `statusPath`;
- `logPath`;
- `lastEventAt`;
- `filesTouched`;
- `validationResult`;
- `rollbackHint`.

Ferramentas complementares futuras:

- `one_slice_agent_run_status(runId)`;
- `one_slice_agent_run_abort(runId)`;
- `one_slice_agent_run_log_tail(runId, maxLines)`;
- `one_slice_agent_run_reap(runId)`.

## Guardrails obrigatórios

- Default é `dryRun/report-only`.
- Execução exige confirmação humana explícita por task/fatia.
- Bloquear escopo protegido por padrão: settings, routing/providers, CI, publish/release, credenciais, remote/offload, `.obsidian`.
- Timeout default curto para docs-only canary.
- Se timeout expirar, abortar o worker e registrar `timed-out`, sem retry automático.
- O parent valida e decide; o worker não fecha task sozinho.

## Próximo passo local-safe

1. Encerrar/limpar artefatos experimentais do caminho `pi-workflows` que não serão promovidos.
2. Criar decision packet para `one_slice_agent_run` L1, começando report-only.
3. Implementar apenas status/preview primeiro.
4. Só depois permitir um novo canary com timeout e abort testados.
