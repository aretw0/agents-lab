# Prior art: `/btw` / side conversations (2026-04-30)

## Contexto

`TASK-BUD-296` criou um rascunho first-party de prompt `/btw`, mas o operador lembrou que não devemos tornar isso canônico antes de comparar com implementações já instaladas, especialmente `oh-pi` e Mitsuhiko/mitsupi.

Conclusão desta fatia: manter o rascunho como referência local, mas **não expor via `pi.prompts` nem empacotar como superfície canônica** até decisão explícita.

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

## Referências adjacentes: `mitsupi`

Busca bounded local não encontrou equivalente direto a `/btw` em `node_modules/mitsupi`. Itens adjacentes inspecionados:

- `node_modules/mitsupi/skills/pi-share/SKILL.md`: carrega/transcreve sessões compartilhadas de pi e pode gerar resumo humano;
- `node_modules/mitsupi/skills/summarize/SKILL.md`: converte documentos/URLs para Markdown e opcionalmente resume.

Essas skills são úteis para contexto, resumo e análise de sessões/documentos, mas não implementam conversa lateral paralela no estilo `/btw`.

## Riscos de tornar first-party cedo demais

- Duplicar sem necessidade uma extensão já instalada e mais completa.
- Confundir prompt template com runtime command: prompt não oferece thread isolado, widget, save, inject/summarize controlado ou exclusão garantida do contexto principal.
- Introduzir superfície que parece leve, mas pode induzir o agente a capturar backlog/alterar foco sem decisão explícita.
- Criar conflito de comando se o usuário já tem `/btw`/`/qq` via `oh-pi`.

## Contrato desejado antes de qualquer versão first-party

Qualquer versão futura deve ser opt-in e decidir explicitamente entre:

1. reutilizar `oh-pi` como implementação preferida;
2. envolver/filtrar `oh-pi` com guardrails locais;
3. criar alternativa first-party runtime, não apenas prompt;
4. manter somente skill/docs orientando o uso de `oh-pi`.

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
- Reabrir design somente com uma task dedicada se o operador quiser wrapper first-party, filtro de `oh-pi` ou alternativa runtime.
