# Matriz curatorial de design para `/btw`

Status: curadoria para decisão futura; não é implementação nem exposição first-party.

## Objetivo

Comparar decisões de design observadas em referências de `/btw`/side-chat antes de decidir se a stack deve reutilizar, filtrar, wrappar, criar uma alternativa runtime first-party ou manter apenas documentação. Esta matriz complementa `docs/research/btw-prior-art-2026-04-30.md`.

## Referências consideradas

| Referência | Tipo | Evidência local desta curadoria | Observação |
| --- | --- | --- | --- |
| `@ifi/oh-pi` | extensão runtime + skill | `node_modules/@ifi/oh-pi-extensions/extensions/btw.ts`; `node_modules/@ifi/oh-pi-skills/skills/btw/SKILL.md`; pesquisa já registrada | Implementa `/btw` e `/qq`, thread lateral, widget, aliases, save/inject/summarize. |
| `mitsuhiko/agent-stuff` | extensão runtime remota | cache local `~/.cache/checkouts/github.com/mitsuhiko/agent-stuff/extensions/btw.ts`; pesquisa já registrada | Implementa overlay/side-chat com `AgentSession` separada, entries customizadas e injeção de summary. |
| `dbachelder/pi-btw` | referência upstream declarada por prior art | mencionado como origem declarada no ecossistema `oh-pi`; não re-inspecionado nesta fatia | Tratar como fonte histórica/importante, mas não acoplar sem leitura bounded dedicada. |
| `packages/lab-skills/prompts/btw.md` | rascunho prompt local | arquivo local mantido fora de `pi.prompts` e fora de `files` do pacote | Útil como contrato mínimo de conversa lateral, mas não substitui runtime side-session. |

## Eixos de decisão

| Eixo | `oh-pi` | `mitsuhiko/agent-stuff` | Rascunho prompt local | Direção curatorial recomendada |
| --- | --- | --- | --- | --- |
| Forma da superfície | comandos runtime `/btw` e `/qq` com aliases | overlay runtime `/btw` | prompt template textual | Se virar first-party, deve ser runtime opt-in; prompt sozinho fica docs/reference. |
| Isolamento da conversa | thread lateral e exclusão do contexto principal por filtro | `AgentSession` separada em memória, sem recursos laterais extras no loader | só instrução ao modelo | Exigir isolamento real ou deixar claro que é apenas orientação textual. |
| Persistência | entries customizadas e comandos de reset/clear | entries customizadas `btw-thread-entry`/`btw-thread-reset` | nenhuma persistência própria | Persistência deve ser explícita, bounded e resetável. |
| UI | widget acima do editor | popover/overlay | nenhuma UI própria | UI é opcional, mas se houver deve deixar o foco principal visível. |
| Injeção no chat principal | `/btw:inject` e `/btw:summarize` explícitos | summary ao fechar/seguir fluxo da extensão | instrução para preservar foco | Injeção precisa ser comando/decisão explícita e auditável; summary deve ser bounded. |
| Execução de tools | extensão pode usar capacidades do pi conforme implementação | side session usa `codingTools` | contrato proíbe executar comandos | Para governança local-first, side-chat deve iniciar advisory/no-tools ou tools filtradas. |
| Captura como backlog | pode salvar nota (`--save`) | summary/injeção para main chat | só por pedido explícito via board bounded | Captura em board deve ser opt-in e usar superfícies bounded. |
| Custo/modelo | usa modelo/API do pi | usa sessão/modelo do pi | depende da conversa principal | Exigir visibilidade mínima de custo/modelo antes de promover. |
| Conflito de comando | já ocupa `/btw` e `/qq` | ocupa `/btw` | ocuparia `/btw` se publicado | Antes de expor first-party, detectar/evitar conflito silencioso. |
| Governança unattended | não é desenhada primariamente para control-plane local-first | oferece side session poderosa, inclusive tools | contrato local é mais restritivo | Não usar `/btw` como via de execução unattended; manter advisory por padrão. |

## Opções futuras

| Opção | Quando escolher | Bloqueios antes de escolher |
| --- | --- | --- |
| Reutilizar implementação externa | Uma referência instalada já satisfaz isolamento, UX e governança suficientes. | Verificar conflito de comandos, filtros de tool, custo/modelo e capacidade de desabilitar injeção automática. |
| Wrappar/adaptar referência externa | A referência é boa, mas precisa de guardrails locais, telemetria ou filtros. | Definir boundary de wrapper, testes de não execução, e política de atualização externa. |
| Filtrar/suprimir extensão existente | O pacote traz `/btw`, mas conflita com perfil recomendado ou superfície local. | Registrar decisão em curation/capability owners; não quebrar instalação do usuário sem opt-in. |
| Criar runtime first-party opt-in | Nenhuma referência preserva os invariantes locais ou precisamos de integração forte com board/handoff. | Exige tarefa separada, UI/runtime design, tests, reload live, conflito de comando e orçamento/custo. |
| Manter docs/skill apenas | A necessidade é só orientar conversa lateral e preservar foco. | Deixar explícito que não há side-session real nem persistência isolada. |

## Recomendação atual

Não publicar `/btw` first-party agora. O caminho mais seguro é manter o rascunho local como referência não empacotada e usar esta matriz para uma decisão futura. Se o operador quiser avançar, a próxima tarefa deve escolher explicitamente uma das opções futuras acima.

Decisão default para a stack local-first:

1. preservar `/btw` como curadoria e contrato de invariantes, não como superfície canônica;
2. preferir advisory/no-tools por padrão;
3. exigir injeção explícita no chat principal;
4. exigir captura de backlog apenas por pedido explícito e superfície bounded;
5. antes de qualquer runtime first-party, validar conflito de comandos e custo/modelo;
6. não acoplar automaticamente a `oh-pi`, `mitsuhiko/agent-stuff` ou `dbachelder/pi-btw`.

## Critério de pronto para implementação futura

Uma nova tarefa de implementação só deve começar quando houver decisão explícita para uma opção. O pacote de decisão deve declarar:

- comando(s) que serão expostos e como evitar conflito;
- se a lateral tem tools, quais filtros se aplicam e como bloquear mutação;
- onde o thread persiste e como resetar;
- como a injeção no chat principal é autorizada e auditada;
- como custo/modelo ficam visíveis;
- quais testes provam que foco, board, handoff e execução principal permanecem preservados.
