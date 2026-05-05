# Matriz Symphony pattern → pi-stack primitive

Status: proposta local-safe  
Base: `docs/research/openai-symphony-influence-2026-05.md`  
Regra: este documento não habilita scheduler externo, Linear, Codex app-server, dispatch remoto ou execução unattended nova.

## Objetivo

Transformar a pesquisa sobre OpenAI Symphony em uma matriz de assimilação governada. Cada padrão vira uma direção de primitiva, teste ou documentação dentro do control-plane local-first, preservando a política atual de protected scope explícito.

## Matriz

| Padrão observado em Symphony | Primitiva pi-stack relacionada | Assimilação local-safe | Fora de escopo agora |
| --- | --- | --- | --- |
| `WORKFLOW.md` como contrato versionado de execução | `.project/tasks.json`, `.project/verification.json`, `.project/handoff.json`, docs de primitives | Documentar quais campos são fonte de verdade para seleção, validação, checkpoint e rollback | Substituir board canônico por workflow externo |
| Orquestrador com estado autoritativo para `claimed/running/retry` | `scheduler_governance_status`, lane queue, `autonomy_lane_next_task`, handoff freshness | Definir antes de qualquer loop quem é owner do estado e qual sinal bloqueia dispatch | Criar daemon multi-agent persistente |
| Workspaces isolados por issue | `worktree`, `agent_spawn_readiness_gate`, rollback plan, declared files | Exigir escopo de arquivos/worktree e rollback antes de delegação simples | Executar agentes em paths não canonicalizados ou compartilhados |
| Status surface opcional | `operator-visible-output`, `monitors_compact_status`, context-watch status | Manter content summary-first e `details` estruturado como payload completo | Fazer UI/status virar fonte de verdade operacional |
| Reload fail-closed com last-known-good | `context_watch_status`, reload intent, handoff checkpoint | Expor `reload-required`, `last-known-good` e blockers em frase curta operator-visible | Auto-reload/autoresume sem canary explícito |
| Preflight por tick antes de dispatch | `autonomy_lane_status`, machine/context/provider gates | Revalidar gates imediatamente antes da próxima fatia, não só no planejamento | Dispatch quando gates estão stale |
| Workpad persistente com critérios e validação | task notes, verification entries, handoff | Manter aceite + validação no board, não apenas no resumo final | Comentários soltos sem vínculo a verification |
| Defaults de sandbox/approval documentados | guardrails de protected scope, human confirmation, path guard | Registrar defaults seguros e diferenças de trust posture por lane | Copiar `approval_policy: never` como default |

## Critérios de uso

Uma influência externa só pode virar implementação quando cumprir todos os itens abaixo:

1. A fatia proposta é local-first e reversível.
2. O arquivo ou superfície de destino está declarado no task board.
3. Há validação focal antes de completar a task.
4. Protected scope está ausente ou explicitamente autorizado por foco humano.
5. A mudança melhora uma primitiva existente ou cria documentação/teste antes de runtime novo.

## Próximas fatias candidatas

- `context-watch`: adicionar wording compacto para `last-known-good` quando reload está pendente.
- `operator-visible-output`: migrar mais uma tool report-only que ainda retorna JSON cru em `content`.
- `board`: criar um relatório read-only que mostre owner de estado para lanes (`board`, `handoff`, `scheduler`, `worktree`).

## Não-objetivos

- Não criar integração Linear.
- Não executar Symphony.
- Não criar scheduler remoto.
- Não alterar política de protected scope.
- Não aumentar concorrência/autonomia sem rehearsal local e canary explícito.
