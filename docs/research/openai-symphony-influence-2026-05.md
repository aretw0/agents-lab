# OpenAI Symphony — influência bounded para o control-plane/pi-stack

Data: 2026-05-05  
Fonte: `openai/symphony` em `58cf97da06d556c019ccea20c67f4f77da124bf3`  
Escopo: pesquisa de influência, sem adoção operacional automática e sem dispatch externo.

## Resumo executivo

Symphony é útil como referência para amadurecer o control-plane local-first em cinco áreas: contrato de workflow versionado, orquestrador como autoridade única, workspaces isolados por item, observabilidade operator-visible e recarga/configuração fail-closed. A influência deve ser absorvida como padrões pequenos e auditáveis, não como scheduler remoto nem como alteração de política de execução.

## Evidência de fonte

- O spec define explicitamente os objetivos de polling com concorrência limitada, estado autoritativo do orquestrador, workspaces determinísticos, parada quando o item fica inelegível, observabilidade e recuperação por tracker/filesystem sem depender de banco persistente ([`SPEC.md` L48-L56](https://github.com/openai/symphony/blob/58cf97da06d556c019ccea20c67f4f77da124bf3/SPEC.md#L48-L56)).
- A arquitetura separa superfície de status e logging: a status surface é opcional e operator-facing, enquanto logs estruturados são um sink mínimo ([`SPEC.md` L107-L112](https://github.com/openai/symphony/blob/58cf97da06d556c019ccea20c67f4f77da124bf3/SPEC.md#L107-L112)).
- A recarga de `WORKFLOW.md` deve manter a última configuração válida quando a nova configuração é inválida, emitindo erro visível ao operador em vez de derrubar o serviço ([`SPEC.md` L524-L540](https://github.com/openai/symphony/blob/58cf97da06d556c019ccea20c67f4f77da124bf3/SPEC.md#L524-L540)).
- O preflight por tick valida configuração antes de dispatch e, se falhar, pula o dispatch mas mantém reconciliação ativa e erro operator-visible ([`SPEC.md` L542-L566](https://github.com/openai/symphony/blob/58cf97da06d556c019ccea20c67f4f77da124bf3/SPEC.md#L542-L566)).
- A implementação Elixir ordena candidatos e só despacha quando o item é candidato, não está bloqueado, não foi claimed/running, há slots disponíveis e limites por estado/worker permitem ([`orchestrator.ex` L520-L567](https://github.com/openai/symphony/blob/58cf97da06d556c019ccea20c67f4f77da124bf3/elixir/lib/symphony_elixir/orchestrator.ex#L520-L567)).
- Workspaces são derivados do identificador sanitizado e canonicalizados sob a raiz configurada ([`workspace.ex` L196-L208](https://github.com/openai/symphony/blob/58cf97da06d556c019ccea20c67f4f77da124bf3/elixir/lib/symphony_elixir/workspace.ex#L196-L208)).
- A configuração Codex tem defaults mais seguros quando policy fields são omitidos, incluindo `approval_policy` em forma de reject e sandbox workspace-write ([`elixir/README.md` L112-L118](https://github.com/openai/symphony/blob/58cf97da06d556c019ccea20c67f4f77da124bf3/elixir/README.md#L112-L118)); o schema materializa esse default ([`config/schema.ex` L160-L176](https://github.com/openai/symphony/blob/58cf97da06d556c019ccea20c67f4f77da124bf3/elixir/lib/symphony_elixir/config/schema.ex#L160-L176)).
- O `WORKFLOW.md` exige workpad persistente, plano/aceitação/validação explícitos e atualização após marcos significativos ([`WORKFLOW.md` L196-L214](https://github.com/openai/symphony/blob/58cf97da06d556c019ccea20c67f4f77da124bf3/elixir/WORKFLOW.md#L196-L214)).
- A status dashboard consome snapshot do orquestrador e renderiza estado operacional, mantendo status como observabilidade e não como fonte de verdade ([`status_dashboard.ex` L550-L566](https://github.com/openai/symphony/blob/58cf97da06d556c019ccea20c67f4f77da124bf3/elixir/lib/symphony_elixir/status_dashboard.ex#L550-L566)).

## Padrões reaproveitáveis

### 1. Contrato de workflow versionado, mas local-first

Aplicação no pi-stack: continuar tratando `.project/handoff.json`, `.project/tasks.json` e docs de política como contrato canônico local. O padrão útil é declarar claramente quais campos controlam seleção, dispatch, validação, recarga e fallback. Não importar: dependência em Linear ou daemon remoto como requisito para o loop local.

### 2. Orquestrador como única autoridade de dispatch

Aplicação: consolidar qualquer futuro loop unattended em uma superfície que mantém `claimed/running/retry` ou equivalentes, em vez de múltiplos comandos concorrentes inferirem estado independentemente. Para a stack atual, isso reforça `scheduler_governance_status`, lane queue e handoff como fontes de reconciliação antes de execução.

### 3. Workspaces por item com path safety explícito

Aplicação: quando houver delegação ou agentes simples, preferir worktree/workspace por tarefa com path canonicalizado e rollback conhecido. O padrão é reaproveitável mesmo sem rodar agentes: planos de slice devem declarar escopo de arquivos e caminho de workspace antes de executar.

### 4. Status surface é observabilidade, não autoridade

Aplicação: a linha de UI iniciada em `TASK-BUD-828` está alinhada: outputs devem ser summary-first e manter `details` estruturado. Symphony reforça que dashboard/status não deve ser necessário para correctness; a verdade permanece em estado canônico + logs/evidência.

### 5. Reload/config inválida deve ser fail-closed e last-known-good

Aplicação: fortalecer o contrato de `/reload` do pi-stack para distinguir claramente: source changed, reload required, last-known-good runtime, blocked dispatch e evidence path. Erro de reload não deve apagar handoff nem disparar execução não validada.

### 6. Workpad persistente como trilha de aceitação

Aplicação: o equivalente local é task note + verification + handoff. O padrão reaproveitável é exigir que validação e critérios de aceite estejam marcados no mesmo registro canônico usado para continuação; evitar comentários soltos ou resumos finais desconectados do board.

## Recomendações bounded

1. Criar um follow-up local-safe para documentar uma matriz `Symphony pattern → pi-stack primitive`, sem ativar scheduler novo.
2. Avaliar se `context_watch_checkpoint` deve registrar explicitamente `last-known-good`/`reload-required` em formato mais compacto para UI.
3. Manter status/operator output como summary-first; continuar migrações pequenas iniciadas por `TASK-BUD-828`.
4. Não importar `approval_policy: never` do exemplo `WORKFLOW.md`; para o pi-stack, tratar isso como exemplo de ambiente trusted, não como default seguro.
5. Não adicionar integração Linear/Symphony runtime agora; a absorção deve ficar em docs/primitives e testes locais.

## Limites e riscos

- Symphony mira ambientes trusted e execução unattended de Codex; isso é mais agressivo que a política atual do pi-stack.
- A referência inclui live e2e com Linear e Codex real; não executei esses testes e não há recomendação para adotá-los agora.
- O valor imediato está nos contratos de governança e observabilidade, não em copiar a implementação.
