# Doutrina operacional do control-plane unattended

Este guia consolida as opiniões operacionais que devem orientar o agente quando estiver trabalhando em modo local-first, com pouco atrito humano, sem perder governança.

## Norte

O objetivo não é automatizar tudo. O objetivo é manter trabalho contínuo, organizado e auditado, parando apenas quando houver risco real, decisão estratégica ou escopo protegido.

## Princípios

1. **Local-first antes de remoto** — provar no PC local antes de GitHub Actions, remote runners, subagentes persistentes ou offload.
2. **Foco explícito governa a execução** — o foco atual vem do operador, do handoff ou de uma seleção local-safe registrada.
3. **Foco completo não é parada automática** — se existe uma próxima melhoria local, pequena, segura e óbvia, o agente deve continuar com uma nova fatia auditável.
4. **Checkpoint não é medo** — em `warn` ou `checkpoint`, salvar progresso e continuar bounded; só parar em `compact`, risco ou bloqueio real.
5. **Board/handoff/verification são a autoridade** — docs e commits explicam, mas o estado operacional deve estar recuperável pelo board e handoff.
6. **Commits pequenos são uma guardrail** — cada fatia deve ter intenção clara, validação focal e staging limitado.
7. **Diagnóstico tem cadência** — evitar abrir pacotes de status por hábito; usar quando há reload, checkpoint, seleção, troubleshooting ou risco.
8. **Escopos protegidos exigem intenção explícita** — CI, GitHub Actions, remote execution, publish, `.pi/settings.json`, `.obsidian/` e pesquisa externa não entram por seleção automática.
9. **Inspirações são insumo, não desvio** — Squeez, mdt, impeccable.style e referências externas entram como tarefas explícitas e bounded.
10. **Qualidade vem de síntese, remoção e consistência** — preferir reduzir superfícies redundantes e consolidar opiniões antes de adicionar novas ferramentas.
11. **Unattended é malemolência com trilho** — continuar sozinho em fatias seguras, mas deixar rastro curto para auditoria e retomada.

## Memória de projeto e adapters

A stack recomenda que cada projeto tenha alguma memória operacional: tarefas, decisões, verificações e handoff precisam existir em uma forma recuperável. O formato atual em `.project/` é o adapter local-first inicial porque é simples, versionável e auditável no PC.

Esse começo não deve virar lock-in. As primitivas devem permanecer agnósticas o suficiente para que o usuário monte a própria memória com pi, seja via `.project/`, GitHub Issues, GitLab, Linear/Jira ou outro ticket system. O contrato importante é a capacidade: criar/selecionar tarefa, registrar evidência, atualizar status, preservar rationale e retomar por handoff.

Quando uma tool usar `board`, leia como a superfície local atual para esse contrato, não como a única arquitetura futura.

## Fluxo bounded do board local

Para fatias unattended locais, prefira as primitivas bounded em vez de scripts ad hoc sobre JSON:

1. criar a fatia com `board_task_create` quando ela ainda não existir;
2. executar a mudança pequena e reversível;
3. validar pelo método escolhido (`validation_method_plan`, teste focal, `safe_marker_check` ou structured-read);
4. fechar com `board_task_complete`, que registra verification `passed`, linka a task e marca `completed` em uma chamada;
5. quando o fechamento único não couber, usar o fallback explícito `board_verification_append` + `board_update`.

Registre o `summary` compacto dessas tools quando ele for suficiente para handoff ou log. Sucesso e falha devem caber em uma linha curta, por exemplo `board-task-complete: ok=yes ...` ou `board-task-complete: ok=no ... reason=...`; só expanda o JSON completo quando estiver investigando erro.

Esse fluxo é sobre capacidades, não sobre lock-in: adapters futuros devem oferecer operações equivalentes de criar tarefa, registrar evidência, atualizar status e preservar rationale.

## Quando continuar sem perguntar

Continue automaticamente quando todos os itens forem verdadeiros:

- o próximo passo é local-first;
- a mudança é pequena e reversível por git;
- a validação focal é conhecida;
- não toca escopo protegido;
- não exige escolha de produto ou preferência subjetiva;
- o handoff está fresco ou será atualizado antes de compact;
- o foco atual está claro ou a próxima fatia local-safe é óbvia.

Exemplo: após fechar uma tarefa de rehearsal, criar uma pequena tarefa de doutrina ou reduzir bloat documental é aceitável se isso responde diretamente ao feedback do operador.

A primitiva `resolveUnattendedContinuationPlan` codifica essa decisão: `continue-local` quando a próxima fatia é local-safe, `ask-decision` quando o próximo passo é ambíguo, `blocked` para risco ou escopo protegido, `checkpoint` quando falta progresso salvo, e `pause-for-compact` quando o contexto já está em compact com progresso preservado.

Em runtime, use a tool `unattended_continuation_plan` como checagem curta em boundaries de reload/checkpoint/ambiguidade. Prefira registrar o `summary` compacto no handoff; não abra pacote diagnóstico amplo quando essa decisão local basta.

## Quando parar ou pedir decisão

Pare, faça checkpoint ou peça decisão quando houver:

- risco de perda de dados, credenciais, segurança ou custo;
- mudança em CI/remote/publish/settings protegidos;
- pesquisa externa ampla;
- falha de teste sem correção local óbvia;
- conflito entre caminhos estratégicos;
- contexto em compact sem progresso salvo;
- próximo foco realmente ambíguo.

## Escolha da próxima fatia local-safe

Quando o foco termina e não há canário remoto autorizado, priorize:

1. **remoção de gordura** — reduzir repetição, listas longas, superfícies redundantes e prompts inchados;
2. **organização das opiniões** — consolidar decisões operacionais em uma doutrina curta;
3. **refactor leve** — separar módulos grandes só quando o comportamento já está estável;
4. **testes/regressões** — transformar regra aprendida em teste pequeno;
5. **inspirações bounded** — extrair princípios de uma referência externa apenas quando a tarefa for explícita.

Remote/offload só vem depois de scorecard local verde e intenção explícita do operador.

## Lei anti-spoof

Tools disponíveis ao agente para desenvolvimento, feedback constante e validação manual não equivalem a autorização operacional. Uma superfície advisory pode receber parâmetros manuais para facilitar calibração, mas gates de autonomia não podem produzir readiness sensível a partir de input spoofável.

Quando um gate desbloqueia continuidade, reload, scheduler, remoto, custo, escrita ampla ou qualquer ação sensível, o caminho maduro deve derivar sinais medidos do estado local e anexar evidência bounded. Flags como `ready`, `measured` ou `all-gates-green` não bastam sem origem confiável, evidência compacta e falha fechada.

A regra de maturidade é separar ferramenta conveniente de desenvolvimento de permissão operacional. Quando a stack estiver funcional o suficiente para loops maiores, parte do trabalho desses loops deve ser higiene da própria casa: reduzir tools desnecessárias ao agente, esconder overrides de desenvolvimento, promover apenas superfícies medidas e manter as demais como advisory/read-only.

Helpers medidos e re-exports canônicos também não são autorização operacional. Um helper como `resolveLocalMeasuredNudgeFreeLoopCanaryGate` pode compor evidência local para testes e consumidores internos, mas isso não cria scheduler, self-reload, loop, auto-continuação nem permissão remota. Até existir um desenho auditado separado, a tool runtime `nudge_free_loop_canary` permanece advisory/manual-only e deve continuar falhando fechado com `manual-signal-source` quando receber apenas parâmetros manuais.

## Superfície measured auditada futura

Antes de implementar qualquer superfície runtime measured, revise as primitivas existentes e o scorecard de higiene (`TASK-BUD-252`). Se já houver helper, tool ou doutrina com responsabilidade parecida, prefira estender, fundir ou refatorar em vez de criar uma nova superfície. A pergunta padrão deve ser: isso reduz ambiguidade operacional ou apenas adiciona mais um caminho sobreposto?

O contrato mínimo para uma primeira superfície measured deve ser read-only e advisory. Ela pode mostrar um packet derivado de fatos locais confiáveis, com evidência completa e bounded por gate, mas não pode iniciar scheduler, self-reload, loop, auto-continuação, remoto ou escrita ampla. Import canônico, helper medido e re-export não são permissões operacionais.

A superfície deve falhar fechada quando faltar origem local confiável, checkpoint fresco, orçamento de handoff, git state esperado, escopos protegidos clear, cooldown, validação conhecida, stop conditions clear ou evidência compacta. Um resultado `ready` só pode ser tratado como evidência para decisão posterior; autorização para operação ininterrupta exige desenho separado, auditável e explicitamente selecionado.

## Self-reload e autoresume

Self-reload executado pelo agente ainda é backlog/canary opt-in, não comportamento automático atual. Antes de qualquer tentativa unattended real, o contrato mínimo precisa provar: checkpoint bounded fresco, orçamento do handoff dentro do limite, git state esperado, ausência de escopos protegidos pendentes, cooldown, auditoria e auto-resume minimal a partir do handoff compacto.

Enquanto esse contrato não existir, reload continua sendo intervenção do operador. O objetivo futuro é permitir que o agente solicite/execute reload somente quando esses gates estiverem verdes e falhe fechado quando faltar evidência de progresso preservado.

## Loop local sem empurrões manuais

Os empurrões manuais do operador ainda substituem um idle continuation loop seguro. O canário futuro desse loop só deve continuar sozinho quando conseguir selecionar a próxima fatia local-safe, gravar checkpoint bounded fresco, respeitar orçamento do handoff, confirmar git state esperado, evitar escopos protegidos, aplicar cooldown, executar validação/smoke conhecido e parar em stop conditions reais.

Stop conditions reais incluem risco de perda de dados, escopo protegido, ambiguidade de produto, falha sem correção local óbvia, compact sem progresso salvo, reload sem contrato aprovado ou handoff inválido. Até esse canário existir, a continuidade sem empurrões permanece backlog explícito, não automação implícita.

## Método de validação

Quando a fatia pode continuar mas o método de validação não está óbvio, use `validation_method_plan` como checagem curta. A regra operacional é:

- markers de texto devem ir para `safe_marker_check` ou `evaluateTextMarkerCheck`, não para shell inline;
- marker check shell-inline com sintaxe command-sensitive é caminho legado bloqueado pelo bash guard;
- teste focal só deve rodar quando o gate é conhecido e bounded;
- inspeção read-only deve usar structured-read quando aplicável;
- validação que toca escopo protegido ou exige mutação deve bloquear e pedir intenção explícita.

Registre o `summary` compacto da decisão quando ele explicar por que o método escolhido é seguro.

## Testes de path cross-platform

Testes que validam paths devem ser agnósticos ao host. Quando a regra testada é formato canônico portátil, use fixtures literais com `/` e `\\` como strings de entrada e compare com evidência normalizada, em vez de montar expectativas com `path.join`, `path.resolve` ou separadores do sistema atual. O objetivo é provar que Windows, Linux e macOS chegam ao mesmo sinal medido, não que a suite passou por acidente no host local.

## Evidência mínima por fatia

Use uma linha curta:

```text
slice=<n> focus=<task> gate=<comando-ou-inspeção> commit=<sha> drift=<yes|no> next=<ação>
```

Essa linha deve ser suficiente para explicar continuidade sem inflar handoff, board ou docs.

## Falhas recorrentes

Quando o mesmo problema operacional se repetir, use `recurring_failure_hardening_plan` antes de escrever mais um lembrete. A regra é: primeira ocorrência pode virar regra curta; segunda ocorrência deve virar hard intent com primitiva e teste; depois disso, adicionar guard runtime ou bloquear o caminho antigo se ele continuar disponível.

O objetivo é evitar soft guidance repetida: se o agente continua esbarrando no mesmo problema, a stack deve tornar o caminho seguro mais fácil ou o caminho antigo menos disponível.

## Critério de qualidade crescente

A qualidade está aumentando quando:

- o agente interrompe menos por hesitação;
- o handoff fica mais curto e mais útil;
- decisões repetidas viram doutrina ou teste;
- ferramentas novas substituem ambiguidade, não adicionam ruído;
- refactors reduzem acoplamento sem abrir grandes frentes;
- inspirações externas viram princípios aplicáveis, não backlog difuso;
- remote canaries permanecem opt-in e auditáveis.
