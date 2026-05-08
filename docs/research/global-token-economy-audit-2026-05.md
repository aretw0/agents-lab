# Auditoria global de economia de tokens/contexto — 2026-05

## Decisão

Economia de tokens/contexto é doutrina global da stack, não uma regra só para subagentes.

Aplica a:

- control plane e respostas do operador;
- workers/subagentes e qualquer `agent_run`;
- monitores/classificadores;
- handoff, auto-resume e checkpoints;
- validações/testes e logs;
- documentação operacional;
- provider routing e budget evidence.

## Evidência de quota atual

Evidência manual do operador: DashScope `qwen3-coder-plus` está em `Remaining 246,289 / Total 1,000,000`.

Regra prática: tratar `qwen3-coder-plus` como recurso escasso. Qualquer uso deve carregar orçamento explícito, escopo mínimo, saída curta e validação focal.

## Auditoria bounded de Squeez

Fonte auditada em cache local: `C:/Users/aretw/.cache/checkouts/github.com/claudioemmanuel/squeez`.

Arquivos lidos nesta fatia:

- `README.md`
- `CLAUDE.md`
- `src/config.rs`
- `src/filter.rs`

Principais aprendizados confirmados:

1. **Hook surfaces por host** — Squeez aplica economia onde o host expõe superfície: Bash, Read/Grep/Glob, Monitor, Agent/Task prompt, SubagentStop, compaction e SessionStart.
2. **Compressão em pipeline** — smart-filter, dedupe, grouping e truncation antes do modelo ver output grande.
3. **Deduplicação cross-call** — janela recente, hash exato e fuzzy matching para não repetir material já visto.
4. **Intensidade adaptativa** — muda limites conforme pressão de contexto/token budget.
5. **Resumo denso para outputs enormes** — threshold e resumo curto com erros, arquivos, resultado de teste e tail.
6. **Economia por subagente** — custo de spawn, burn-rate e warnings de calls restantes entram no orçamento de sessão.
7. **Limites para Read/Grep/Glob** — hard onde host permite; soft quando só há arquivo de instruções.
8. **Persona/prompt curto** — instrução inicial terse para reduzir tokens de resposta.
9. **Compressão de memória/docs** — `compress-md` e avisos de tamanho para arquivos carregados no prompt.
10. **Protocolo auto-teach/MCP** — ferramenta expõe marcadores e memória para o agente entender a economia.

Limite da auditoria: não foi uma leitura exaustiva de todos os testes/handlers. Não afirmar “aprendemos tudo”; afirmar apenas “cobrimos estes padrões com evidência bounded”.

## Comparação com o que já temos

| Padrão | Estado local | Evidência local | Lacuna |
| --- | --- | --- | --- |
| Budget evidence por provider/model | implementado parcial | `guardrails-core-provider-budget-evidence.ts`, quota surfaces | precisa virar regra global de seleção antes de qualquer worker/monitor caro |
| Worker declared files + output curto | implementado para agent-run | `agent_invocation_spec_packet`, `economyMode`, `maxOutputLines` | falta propagar para outras invocações/workflows/colonies |
| Dedupe/stale suppression | implementado parcial | monitor stale prefilter, monitor empty-response hardening | falta score global de ruído por superfície |
| Handoff compacto por slice | implementado parcial | `context_watch_checkpoint`, stop state, truncation helpers | falta budget explícito por campo de handoff/auto-resume |
| Intensidade adaptativa | implementado parcial | context-watch levels, economyMode | falta mapa único ok/warn/checkpoint/compact → limites de output por superfície |
| Read/Grep/scan limits | implementado parcial | safe_marker_check, shell guard, declaredFiles | falta política uniforme de broad-scan avoidance para control plane e workers |
| Prompt persona/terse mode | parcialmente implícito | agent economy prompt prefix | falta contrato global de resposta curta do próprio control plane |
| Compressão de docs/memória | não implementado como compressor | docs/MDT marker checks e handoffs compactos | avaliar sem instalar Squeez nem mutar configs globais |
| MCP/protocolo auto-teach | não implementado | tool docs e operator-visible summaries | possível backlog: pacote compacto de “economy protocol” para workers |

## Política global proposta

### P0 — Sempre preservar governança

Economia nunca pode remover:

- decisão e `recommendationCode`;
- blockers reais;
- evidência de validação;
- rollback;
- links canônicos;
- stop status/source em handoff.

### P1 — Escopo mínimo por padrão

- Ler arquivos por caminho explícito.
- Preferir `read` com offset/limit, `rg` focal e marker checks.
- Evitar `find`, `du`, builds amplos e scans recursivos salvo justificativa.
- Para workers: `declaredFiles` obrigatório.

### P2 — Saída curta e estruturada

- Responder em bullets quando possível.
- Separar `summary`, `validation`, `next` e `blockers`.
- Usar `maxOutputLines` para workers e limite mental equivalente para control plane.

### P3 — Dedupe e stale suppression

- Não repetir status se nada mudou.
- Monitores devem preferir delta e evidência nova.
- Auto-resume deve suprimir aviso stale quando runtime atual já reconciliou o estado.

### P4 — Intensidade adaptativa

| Pressão | Modo | Regra |
| --- | --- | --- |
| quota/contexto ok | `standard` permitido | ainda manter foco |
| quota warn ou contexto warn | `conserve` default | saída curta, escopo estrito |
| quota crítica ou modelo escasso | `critical` | só fatias necessárias, sem worker exploratório |
| block/pause | stop/checkpoint | não gastar provider |

### P5 — Validação mínima suficiente

- Rodar teste focal, não suíte ampla, salvo necessidade.
- Preferir marker checks seguros para docs.
- Registrar validação e parar.

## Implicações para TASK-BUD-1001

Antes do primeiro canary de mutação:

- usar `economyMode=critical` ou `conserve`;
- usar `maxOutputLines` pequeno;
- declarar poucos arquivos;
- evitar Qwen se outro modelo barato/suficiente estiver disponível com budget ok;
- pedir confirmação explícita antes de dispatch;
- avaliar output com `agent_run_outcome_packet` e rejeitar saída vazia ou fora do contrato.

## Backlog sugerido

1. `global_economy_contract` report-only: pacote de decisão por superfície (`control-plane`, `worker`, `monitor`, `handoff`, `validation`).
2. Limites explícitos para handoff/auto-resume por nível de contexto.
3. Métrica de ruído: tokens/linhas evitadas por dedupe/stale suppression.
4. Protocolo compacto de economia para workers inspirado no `squeez protocol`, sem instalar Squeez nem hooks globais.
5. Matriz de modelos alternativos para substituir `qwen3-coder-plus` quando quota ficar baixa.
