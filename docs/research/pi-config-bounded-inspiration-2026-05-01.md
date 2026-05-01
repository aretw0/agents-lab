# pi-config como inspiração bounded para continuidade local-first

Status: pesquisa bounded para `TASK-BUD-268`; não copia código, não instala pacote, não altera `.pi/settings.json`, não habilita subagentes, web tools, read-only mode ou memória persistente.

Referência lida: `https://github.com/amosblomqvist/pi-config`, checkout local via `git-checkout-cache` em `~/.cache/checkouts/github.com/amosblomqvist/pi-config`, commit `575a0a5` (`2026-04-28T14:16:32+03:00`).

## Escopo da leitura

Arquivos lidos de forma bounded:

- `README.md`
- `extensions/filechanges/README.md`
- `extensions/filechanges/index.ts`
- `extensions/zz-read-only-mode.ts`
- `extensions/bash-guard/README.md`
- `extensions/subagents/README.md`
- `extensions/context.ts`
- `extensions/memory.ts`
- `skills/stop-slop/SKILL.md`

## Ideias úteis

### 1. Instalação por peças, não pacote monolítico

O `README.md` deixa claro que o repo não deve ser clonado sobre `~/.pi/agent`; a proposta é copiar peças específicas. Isso combina com a nossa regra de curadoria: referências externas entram como insumo bounded, não como pacote ativado inteiro.

Aplicação local:

- manter `@aretw0/pi-stack` como owner das superfícies críticas;
- quando uma referência externa for útil, registrar a capability específica antes de qualquer adoção;
- preferir wrapper/filtro/PR ou task explícita, nunca copiar diretório inteiro para a config live.

### 2. File changes como trilho de revisão antes de aceitar/reverter

`extensions/filechanges` rastreia alterações feitas por `edit`/`write`, mostra status/widget, oferece `/filechanges` para inspecionar e comandos de accept/decline. A ideia central é valiosa para nossa meta: uma fatia local deveria terminar com inventário curto de arquivos alterados e uma decisão explícita de aceitar/reverter.

Diferença para nossa stack:

- já usamos git como rollback principal;
- board/checkpoint são a fonte de auditoria;
- comandos de decline/revert não devem surgir como ação automática.

Aplicação antes de revisar `*-promotion` de colony:

- exigir inventário read-only de arquivos candidate;
- comparar candidate vs branch alvo antes de qualquer materialização;
- gerar decision packet de promoção com `promote/skip/defer`, sem aplicar patch.

### 3. Read-only mode como contrato operacional, não só preferência

`zz-read-only-mode.ts` reduz tools ativas para `read`, `grep`, `find`, `ls` e bloqueia outras chamadas enquanto ligado. A inspiração é forte para a próxima revisão de colony: antes de olhar um candidate, entrar em modo conceitualmente read-only.

Não vamos copiar essa extensão agora. A primitive equivalente local deve ser mais auditável:

- declarar `reviewMode=read-only` no packet;
- bloquear aplicação/commit/staging durante inventário;
- permitir somente leitura, marker checks e diff/stat bounded;
- sair do modo read-only apenas com decisão humana explícita.

### 4. Bash guard separa sessão interativa de subagente headless

`extensions/bash-guard` diferencia prompt interativo no main session e hard-block em subagentes sem UI. Essa separação reforça nossa política: onde não há confirmação humana confiável, o caminho deve bloquear mais forte.

Aplicação local:

- para colony promotion review, qualquer aplicação no branch alvo é protected;
- em modo read-only/review, comandos mutantes ou shell amplo devem bloquear;
- se futuramente houver subagente/worker para inventário, ele deve receber allowlist menor que o agente principal.

### 5. Subagents com tools por papel

`extensions/subagents/README.md` define agentes com ferramentas por função: scout read-only, researcher web, worker write/edit/safe_bash. A ideia de papéis é útil, mas a implementação depende de modelos Anthropic e subagentes, que não são rota viável agora nesta conta.

Aplicação local sem ativar subagentes:

- usar os papéis como checklist manual: scout/inventory primeiro, review depois, worker só em tarefa separada;
- não habilitar subagent runtime até haver provider/cota e cancel/fallback próprios;
- manter `authorization=none` para qualquer packet que apenas classifique readiness.

### 6. Context usage e memória persistente: bons avisos, risco de escrita automática

`context.ts` mostra breakdown visual de contexto; isso conversa com nosso context-watch. `memory.ts` cria/atualiza `MEMORY.md` automaticamente quando ligado; isso é útil como ideia de memória, mas conflita com nossa preferência por board/handoff bounded e por evitar dirty state inesperado.

Aplicação local:

- manter context-watch como owner do orçamento de contexto;
- não adotar memória que escreve arquivo automaticamente sem task/checkpoint;
- qualquer memória futura precisa de single-writer, diff previsível e ligação com board.

### 7. Stop-slop como checklist de qualidade textual

A skill `stop-slop` é uma checklist agressiva contra prosa genérica. Para a nossa stack, a parte aplicável é menor: usar uma checagem de densidade para docs/handoff, sem importar tom ou regras absolutas.

Aplicação local:

- em decision packets, cortar justificativas longas;
- manter evidência curta e acionável;
- evitar frases bonitas que parecem autorização operacional.

## Riscos se adotado sem filtro

- `filechanges-decline` pode reverter arquivos de forma operacional; precisa de decisão humana e escopo claro.
- `read-only mode` altera active tools; numa sessão compartilhada isso pode surpreender o operador se não houver status/rollback claros.
- `memory.ts` escreve `MEMORY.md` automaticamente; isso pode recriar o problema de dirty state inesperado.
- Subagents e web tools dependem de provider/cota e podem ampliar escopo, custo e contexto.
- Web/search/video/pdf skills puxam dependências e rede; fora do escopo local-safe atual.

## Primitivas/backlog sugeridos

1. `colony_promotion_decision_packet` read-only: inventaria candidate, arquivos, validação disponível, riscos e opções `promote/skip/defer`; nunca aplica patch.
2. `review_mode_plan` read-only: declara tool/command allowlist para uma revisão bounded, com `mutationAllowed=false` e `authorization=none`.
3. `file_change_inventory` local: usa git/diff bounded para mostrar arquivos alterados e rollback sugerido, sem accept/decline operacional.
4. `memory_write_gate`: se algum dia houver memória persistente, exigir task vinculada, single-writer e checkpoint; nada de escrita automática invisível.

## Decisão para ir para colony promotion review

A inspiração mais útil para ir à opção 1 com tranquilidade é combinar:

- read-only review mode conceitual;
- inventário de mudanças antes de qualquer promoção;
- decision packet com opções humanas;
- bloqueio de aplicação/staging/commit até decisão explícita.

Próxima fatia recomendada: criar uma task local-safe para desenhar o packet read-only de uma única promotion colony, começando por `colony-c-ret-1-promotion` ou outro candidate escolhido pelo operador. Essa fatia deve inventariar somente; não deve materializar candidate no branch alvo.
