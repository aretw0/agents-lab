# Prior art: `/btw` / side conversations (2026-04-30)

## Contexto

`TASK-BUD-296` criou um rascunho first-party de prompt `/btw`, mas o operador lembrou que não devemos tornar isso canônico antes de comparar com implementações já instaladas, especialmente `oh-pi` e Mitsuhiko/mitsupi.

Conclusão desta fatia: manter o rascunho como referência local, mas **não expor via `pi.prompts` nem empacotar como superfície canônica** até decisão explícita. A pesquisa é curatorial: `oh-pi`, `mitsuhiko/agent-stuff`, `dbachelder/pi-btw` e outras referências são fontes de decisões de design, não backends aos quais devemos acoplar automaticamente. A matriz de decisão fica em `docs/research/btw-curatorial-design-matrix-2026-05-01.md`.

## Referência principal: `@ifi/oh-pi`

Arquivos inspecionados localmente:

- `node_modules/@ifi/oh-pi-extensions/extensions/btw.ts`
- `node_modules/@ifi/oh-pi-skills/skills/btw/SKILL.md`
- `node_modules/@ifi/oh-pi-extensions/README.md`

Características observadas:

- comandos `/btw` e `/qq` para conversa lateral;
- aliases completos: `/btw:new`, `/btw:clear`, `/btw:inject`, `/btw:summarize` e equivalentes `/qq:*`;
- thread lateral contínua, restaurável por entries customizadas;
- widget acima do editor para mostrar respostas sem misturar no fluxo principal;
- exclusão dos BTW notes visíveis do contexto principal via filtro;
- `--save`/`-s` para salvar uma troca como nota visível;
- `/btw:inject` envia o thread completo ao agente principal por mensagem/follow-up;
- `/btw:summarize` resume o thread antes de injetar;
- uso de modelo/API do pi para responder a lateral, ou seja, tem custo e autenticação próprios;
- origem declarada: baseado em `dbachelder/pi-btw`.

Ponto de design importante: `oh-pi` não é apenas prompt template; é uma extensão runtime com UI, estado de thread, comandos de injeção e persistência. Um prompt first-party simples não replica esses invariantes.

## Referência remota: `mitsuhiko/agent-stuff`

O operador apontou a implementação remota relevante:

- `https://github.com/mitsuhiko/agent-stuff/blob/main/extensions/btw.ts`
- cache local usado: `~/.cache/checkouts/github.com/mitsuhiko/agent-stuff/extensions/btw.ts`

Características observadas:

- comando `/btw` como popover/overlay de side-chat;
- cria uma `AgentSession` separada em memória (`SessionManager.inMemory()`), sem skills/prompts/extensions adicionais no resource loader lateral;
- semeia a side session com o contexto principal via `buildSessionContext` e com o thread lateral persistido;
- usa `codingTools`, então a lateral pode executar ferramentas do pi dentro da sessão lateral;
- persiste thread com entries customizadas (`btw-thread-entry`, `btw-thread-reset`);
- restaura thread no `session_start`;
- permite abrir `/btw` sem texto para continuar ou iniciar thread nova;
- ao fechar o overlay, pode injetar **summary** no chat principal;
- resumo usa sessão temporária separada com prompt `BTW_SUMMARY_PROMPT`;
- injeção no chat principal usa `pi.sendUserMessage`, com `followUp` quando o contexto principal não está idle.

Ponto de design importante: a implementação de Mitsuhiko também é runtime/extension, não prompt template. Ela é mais próxima de uma side-session real com overlay e potencial uso de tools, enquanto `oh-pi` enfatiza `/btw`/`/qq`, thread/widget, `--save`, inject/summarize e aliases explícitos. Isso não torna `agent-stuff` o alvo preferido; torna explícitas decisões que precisam ser comparadas e filtradas.

## Referências adjacentes: `node_modules/mitsupi`

A busca bounded local em `node_modules/mitsupi` não encontrou equivalente direto a `/btw`. Isso **não** significa que Mitsuhiko não tenha implementação; a implementação relevante está no repo remoto `mitsuhiko/agent-stuff`, documentado acima. Itens adjacentes inspecionados no pacote local:

- `node_modules/mitsupi/skills/pi-share/SKILL.md`: carrega/transcreve sessões compartilhadas de pi e pode gerar resumo humano;
- `node_modules/mitsupi/skills/summarize/SKILL.md`: converte documentos/URLs para Markdown e opcionalmente resume.

Essas skills locais são úteis para contexto, resumo e análise de sessões/documentos, mas não implementam conversa lateral paralela no pacote `mitsupi` instalado.

## Riscos de tornar first-party cedo demais

- Duplicar sem necessidade extensões runtime já existentes (`oh-pi` e `mitsuhiko/agent-stuff`) e mais completas.
- Confundir prompt template com runtime command: prompt não oferece sessão lateral real, thread isolado, widget/overlay, save, inject/summarize controlado ou exclusão garantida do contexto principal.
- Introduzir superfície que parece leve, mas pode induzir o agente a capturar backlog/alterar foco sem decisão explícita.
- Criar conflito de comando se o usuário já tem `/btw`/`/qq` via `oh-pi`.

## Contrato desejado antes de qualquer versão first-party

Qualquer versão futura deve ser opt-in e decidir explicitamente entre:

1. curar decisões de design de `oh-pi`, `mitsuhiko/agent-stuff`, `dbachelder/pi-btw` e outras referências conhecidas;
2. reutilizar uma implementação externa quando ela for claramente suficiente e compatível com nossa governança;
3. adaptar/wrappar uma implementação existente com guardrails locais quando houver ganho claro;
4. criar alternativa first-party runtime, não apenas prompt, se as referências não preservarem nossos invariantes;
5. manter somente skill/docs orientando o uso de uma implementação externa.

Invariantes mínimos:

- lateral conversacional/advisory;
- não troca foco/task principal por padrão;
- não executa mudanças, comandos, staging, commit, scheduler, remote/offload ou manutenção destrutiva;
- injeção no fluxo principal só por comando explícito do operador;
- captura em board/backlog só por pedido explícito e por superfície bounded;
- custo/modelo/credencial visíveis o suficiente para auditoria;
- sem conflito silencioso com `/btw`/`/qq` existentes.

## Decisão desta fatia

- Não publicar `packages/lab-skills/prompts/btw.md` via `pi.prompts`.
- Não incluir `prompts` em `files` de `@aretw0/lab-skills` por enquanto.
- Preservar o rascunho local como material de comparação, não como superfície carregada para usuários.
- Reabrir design somente com uma task dedicada se o operador quiser uma matriz curatorial de decisões, wrapper first-party, filtro de extensão existente, adaptação de referência externa ou alternativa runtime.
