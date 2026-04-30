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

## Controle humano, cancelamento e blast radius

Confiabilidade de cancelamento é pré-condição para qualquer modo longo ou unattended mais forte. Um `Esc` que não interrompe de forma previsível deve ser tratado como incidente de controle humano, não como detalhe de UX. Até a causa estar classificada, a operação continua limitada a fatias locais, bounded e supervisionadas.

A investigação deve separar três camadas antes de atribuir culpa:

1. **Terminal/sandbox/host** — Windows Terminal, tmux, SSH, PTY, navegador remoto ou sandbox podem impedir que uma tecla chegue ao TUI. Se a limitação estiver nessa camada, registre workaround/fallback e não tente “consertar” configuração pessoal sem intenção explícita.
2. **Upstream pi/TUI** — o binding esperado é `app.interrupt=escape`; o TUI precisa receber o input, manter foco correto e encaminhar para `onEscape`. Durante streaming, compaction, retry, bash ou selectors, o handler pode trocar de significado e deve restaurar o estado anterior ao finalizar.
3. **Extensões e alquimias locais** — extensões podem registrar atalhos, widgets, editor customizado, terminal listeners ou ferramentas longas. Elas não devem capturar `Esc`, substituir o editor ou ignorar `AbortSignal` sem fallback visível.

A evidência mínima para classificar o incidente é curta: keybinding efetivo, presença/ausência de override pessoal, foco/estado do TUI no momento, caminho de abort chamado, e se a operação em curso respeita `AbortSignal` ou mata subprocesso/árvore de processo. Um resultado `ready` de qualquer gate continua sendo evidência, não permissão para executar mais tempo.

Em sessões deste repositório, considere ainda o launcher. O fluxo comum de desenvolvimento é `npm run pi:dev`, que chama `scripts/pi-isolated.mjs --dev`, define `PI_CODING_AGENT_DIR=.sandbox/pi-agent`, usa o CLI local em `node_modules/@mariozechner/pi-coding-agent/dist/cli.js` e pausa o loop autônomo antes de iniciar. Portanto, uma investigação não deve assumir que `~/.pi/agent` ou um pacote publicado representam a sessão live; confira launcher, `PI_CODING_AGENT_DIR`, sourceInfo de recursos e caminhos carregados antes de atribuir comportamento a upstream ou às extensões locais.

Checklist source-aware para `pi:dev`:

- confirmar `npm run pi:isolated:status` e registrar se o modo ativo é `isolated`;
- checar overrides de keybinding no sandbox (`.sandbox/pi-agent/keybindings.json`) além de `~/.pi/agent/keybindings.json`;
- listar somente os pacotes carregados que podem tocar input (`registerShortcut`, `setEditorComponent`, `onTerminalInput`, overlays) com busca curta e sem source maps;
- separar “tecla não chegou ao TUI” de “abort foi chamado, mas a operação não respeitou o sinal”.

Em ferramentas locais que executam subprocessos, `AbortSignal` deve ser repassado para a camada de execução (`pi.exec`/equivalente), mesmo quando há timeout. Timeout é limite temporal; cancelamento é controle humano imediato. Se uma ferramenta longa não propaga o sinal, classifique como risco de controle humano antes de habilitar uso unattended forte.

Status local da auditoria de cancelamento:

- `claude_code_execute` propaga o sinal recebido pelo tool para probes e subprocesso; esse caminho tem smoke test e validação dry-run após reload;
- ferramentas que apenas abrem URL, consultam status curto ou fazem diagnóstico passivo continuam aceitáveis com timeout curto, mas não são prova de cancelamento para long-run;
- comandos interativos/slash commands que disparam execução longa sem contrato explícito de cancelamento não devem ser usados como base para unattended forte;
- qualquer nova ferramenta que invoque subprocesso longo precisa declarar como propaga cancelamento e qual fallback operacional existe.

Pacote upstream/original do pi é superfície protegida. O repositório pode ler `node_modules/@mariozechner/pi-coding-agent` para diagnóstico bounded, mas não deve editar, remover, sobrescrever ou aplicar mudanças diretas nesse pacote instalado. Correções devem ser implementadas por extensão local, wrapper, patch controlado e auditável, ou PR upstream. O guardrail bloqueia mutações diretas por tools de edição/escrita e comandos shell mutantes conhecidos; leituras bounded seguem permitidas.

Skills confiáveis também são superfície de leitura operacional. Em devcontainers ou instalações globais, `SKILL.md` pode viver fora do workspace (por exemplo, em `~/.npm-global/lib/node_modules/@aretw0/...-skills/skills/<nome>/SKILL.md`). Leituras bounded de documentação Markdown dentro de roots de skills confiáveis não devem interromper o runtime com prompt de “leitura fora do projeto”; execução, instalação, scans recursivos e leituras arbitrárias fora do root da skill continuam exigindo bloqueio ou aprovação explícita.

Também existe controle humano sobre o tamanho do diagnóstico. Investigações live não devem abrir saídas grandes, source maps ou scans amplos que empurrem a sessão para auto-compact. Use leitura por arquivo/offset, `head` estrito, `--exclude='*.map'` quando buscar em dependências, `safe_marker_check`/structured-read quando couber, e registre apenas a síntese operacional no board/handoff. Estouro de contexto por diagnóstico é incidente separado e deve virar hardening, não ruído aceito. O guardrail bloqueia scans de blast radius sobre source maps: leitura direta de `*.map` com ferramentas de conteúdo e varreduras recursivas em `node_modules`/`dist`/`build`/`coverage` sem exclusão explícita de `*.map` devem falhar antes de despejar saída no contexto.

Fallback operacional enquanto `Esc` estiver incerto:

- não iniciar long-run, loop, scheduler, self-reload, remote/offload ou executor;
- preferir comandos com timeout curto e saída limitada;
- manter checkpoint fresco antes de qualquer compact/reload;
- se `Esc` falhar, usar fallback explícito do ambiente (`Ctrl+C`, comando de stop do processo, fechar a sessão, ou kill manual pelo operador) e registrar a camada provável.

Matriz go/no-go para trabalho ininterrupto local:

| Condição | Decisão | Observação |
| --- | --- | --- |
| ferramenta passiva/read-only com timeout curto e saída limitada | pode continuar localmente | não prova cancelamento de long-run |
| subprocesso longo com `AbortSignal` propagado, timeout, checkpoint fresco e fallback documentado | candidato a rehearsal local bounded | ainda não autoriza loop/scheduler/remote |
| slash command/interativo sem contrato explícito de cancelamento | no-go para unattended forte | usar apenas com operador presente |
| `Esc` não chega ao TUI ou não aciona abort | no-go para long-run | registrar camada terminal/TUI e usar fallback humano |
| ferramenta ignora abort ou deixa subprocesso órfão | no-go até correção/teste | criar task de hardening antes de promover |

Critério mínimo para promover além de rehearsal bounded: pelo menos um caminho local de execução longa precisa ter cancelamento testado, fallback humano claro, checkpoint prévio, saída limitada e decisão explícita do operador. Sem isso, o trabalho pode continuar em fatias locais pequenas, mas não em modo unattended forte.

## Higiene de tools antes de loops grandes

Antes de qualquer loop grande, a stack deve tratar tools expostas como superfície de risco. A primitiva `tool_hygiene_scorecard` é read-only e classifica tools como `advisory`, `measured`, `operational`, `protected` ou `development`, sinalizando flags como mutação, scheduler, remote/CI, settings/profile, subprocesso e override manual. O resultado mantém `authorization=none` e `dispatchAllowed=false`.

A promoção é conservadora: tools advisory/measured podem permanecer visíveis para fatias locais bounded; tools operational exigem evidência medida e vínculo explícito com task; tools protected exigem aprovação humana e não entram em auto-dispatch; tools de development com subprocesso devem ser ocultadas/desabilitadas antes de loops longos salvo debugging explícito. O scorecard é evidência de higiene, não permissão para executar.

## Entrevistas estruturadas e gaps humanos

Gaps humanos devem ser preenchidos por contrato backend-first antes de qualquer UI. A primitiva `structured_interview_plan` recebe uma lista de perguntas com ids estáveis, tipo, obrigatoriedade, opções, defaults e flags `allowUnknown`/`allowSkip`; recebe respostas parciais; valida sequencialmente; e devolve `complete`, `needs-human-answer` ou `invalid` com `nextQuestionId` e evidência compacta.

Essa primitiva é deliberadamente UI-independent: não abre formulário, não agenda repetição, não despacha executor e mantém `authorization=none` e `dispatchAllowed=false`. TUI, web, Telegram ou forms podem ser adaptadores futuros sobre o mesmo contrato, mas não são a fonte de verdade. Defaults, `unknown` e `skip` só contam quando declarados no schema da pergunta; escolhas inválidas e skips não autorizados falham fechado.

Use esse contrato para preencher lacunas de decisão em revisão humana, contrato one-slice, no-auto-close e gates de execução local. Um resultado `complete` é evidência estruturada, não permissão operacional automática.

## Settings canônico e overlays derivados

`.pi/settings.json` é baseline canônico protegido do projeto. Ele pode ser lido para descobrir políticas, budgets, providers e gates, mas não deve ser reescrito por agentes comuns nem por fatias unattended locais. Mudanças nele exigem intenção explícita do operador, snapshot/rollback quando aplicável e evidência no board.

Configurações específicas de agente, worker, rehearsal ou overnight devem usar overlays derivados separados do canonical. O caminho local reservado é `.pi/derived-settings/<agent-id>.settings.json`. Esses overlays podem ser gerados por ferramentas de preparação ou por adapters específicos, mas não substituem `.pi/settings.json`, não são input para `readSettingsJson` por padrão e não devem fazer o canonical parecer limpo ou sujo.

Regras práticas:

- leitura de política global: usar o settings canônico (`.pi/settings.json`) e fallback de usuário (`~/.pi/agent/settings.json`) quando a tool já tiver esse contrato;
- variação por agente: escrever/ler overlay derivado por id explícito, nunca editar o canonical silenciosamente;
- promoção de overlay para canonical: só com comando/intenção explícita do operador e snapshot;
- readiness/local audit: `.pi/settings.json` modificado continua protected drift real até o operador decidir commitar, reverter ou promover uma mudança;
- agentes específicos não devem depender de mutar o canonical para ajustar comportamento temporário.

Essa separação evita que a própria operação unattended gere bloqueios espúrios em `.pi/settings.json`, mas preserva a proteção quando o baseline canônico realmente diverge.

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

A primeira superfície read-only de audit envelope, quando existir, deve reutilizar o `buildLocalMeasuredNudgeFreeLoopAuditEnvelope` e os coletores locais já existentes. Ela não deve aceitar fatos caller-supplied como elegíveis; deve derivar cada fato a partir de leitura local observável, anexar o collector assessment, mostrar `authorization=none` e apontar claramente que o resultado é evidência para decisão posterior, não comando para continuar. Se algum coletor estiver faltante, untrusted, invalid ou overlong, o envelope deve continuar visível para diagnóstico, mas inelegível.

### Naming: canário `nudge-free` vs primitiva de continuidade

`nudge-free` fica como nome do canário histórico e da tool manual-only atual: ele descreve a pergunta de UX “dá para continuar sem empurrão manual?”. Esse nome continua útil para `nudge_free_loop_canary` e para helpers já publicados que provam que input manual não vira readiness.

A próxima camada não deve herdar esse nome como primitiva principal. Para superfícies read-only futuras, use a semântica `local continuity audit` / `local_continuity_audit`: ela descreve melhor o objeto operacional — um pacote local, auditável, sem autorização, que classifica se uma continuidade poderia ser considerada depois. Isso evita prometer autonomia, evita confundir evidência com permissão e mantém a linguagem centrada em controle local.

Não faça rename amplo prematuro dos helpers `NudgeFree*` já existentes. Antes de qualquer rename público, planeje aliases e compatibilidade. A regra prática é: `nudge-free` nomeia o canário e compatibilidade histórica; `local continuity audit` nomeia a primitiva nova e qualquer futura superfície runtime read-only. Nenhum dos dois nomes autoriza scheduler, loop, self-reload, remoto ou auto-continuação.

## Self-reload e autoresume

Self-reload executado pelo agente ainda é backlog/canary opt-in, não comportamento automático atual. Antes de qualquer tentativa unattended real, o contrato mínimo precisa provar: checkpoint bounded fresco, orçamento do handoff dentro do limite, git state esperado, ausência de escopos protegidos pendentes, cooldown, auditoria e auto-resume minimal a partir do handoff compacto.

Enquanto esse contrato não existir, reload continua sendo intervenção do operador. O objetivo futuro é permitir que o agente solicite/execute reload somente quando esses gates estiverem verdes e falhe fechado quando faltar evidência de progresso preservado.

## Loop local sem empurrões manuais

Os empurrões manuais do operador ainda substituem um idle continuation loop seguro. O canário futuro desse loop só deve continuar sozinho quando conseguir selecionar a próxima fatia local-safe, gravar checkpoint bounded fresco, respeitar orçamento do handoff, confirmar git state esperado, evitar escopos protegidos, aplicar cooldown, executar validação/smoke conhecido e parar em stop conditions reais.

Stop conditions reais incluem risco de perda de dados, escopo protegido, ambiguidade de produto, falha sem correção local óbvia, compact sem progresso salvo, reload sem contrato aprovado ou handoff inválido. Até esse canário existir, a continuidade sem empurrões permanece backlog explícito, não automação implícita.

### Prova verde de readiness local

Um `ready=yes` em `context_watch_continuation_readiness` é evidência read-only, não permissão operacional. Ele não inicia scheduler, loop unattended, self-reload, remoto, offload, compact ou resume por conta própria; a saída deve continuar mostrando `authorization=none`.

A primeira prova verde local só vale quando as condições observáveis estão limpas: baseline canônico de settings já decidido, escopos protegidos fora do foco default, foco `in-progress` pequeno/local-safe, checkpoint fresco sem blockers reais, git state esperado, validation conhecida e smoke/readiness focal passando. Se qualquer uma dessas condições cair, o gate deve voltar a falhar fechado.

Use essa prova como critério de maturidade para desenhar o próximo canário, não como atalho para ativar automação. A promoção de `ready=yes` para execução unattended exige tarefa separada, autorização explícita, rollback e contrato de parada.

### Contrato do próximo canário local

O próximo canário local, quando explicitamente escolhido, deve executar no máximo uma fatia por disparo. O roteiro mínimo é:

1. preflight read-only: `context_watch_continuation_readiness` verde, git state esperado, protected scopes clear, checkpoint fresco e orçamento de handoff dentro do limite;
2. seleção: uma tarefa `in-progress` pequena/local-safe ou uma tarefa recém-criada com validação conhecida;
3. execução: alterar somente arquivos declarados e reversíveis por git;
4. validação: rodar o gate focal planejado ou `safe_marker_check`/structured-read quando for documentação;
5. staging: adicionar somente arquivos intencionais, nunca `.pi/settings.json`, `.github`, `.obsidian` ou remoto sem autorização explícita;
6. fechamento: usar `board_task_complete` ou fallback bounded equivalente;
7. checkpoint: escrever `context_watch_checkpoint` com contexto curto, validação, commits e próximos passos;
8. parada: encerrar o disparo após uma fatia, mesmo se outra oportunidade local-safe existir.

A repetição automática ainda não faz parte desse canário. Para repetir, é necessário um contrato separado de cooldown, limite de fatias, limite de custo/tempo, cancelamento, handoff fresco a cada iteração e stop conditions verificadas antes de cada volta.

Stop imediato: escopo protegido, diff inesperado, teste falhando sem correção óbvia, ambiguidade de produto, contexto em compact sem progresso salvo, reload necessário, checkpoint rejeitado, budget/custo indefinido ou qualquer sinal de perda de dados. Scheduler, remote/offload, self-reload e GitHub Actions continuam fora de escopo até haver tarefa e autorização separadas.

### Escada compacta de decisão

A cadeia compacta validada para o canário local é:

```text
context_watch_continuation_readiness: ready=yes ... authorization=none
context_watch_one_slice_canary_preview: decision=prepare-one-slice prepare=yes stop=yes oneSliceOnly=yes packet=ready-for-human-decision dispatch=no ... authorization=none
```

Leia essa saída como evidência graduada, não como permissão. `ready=yes` diz que os fatos locais observados estão verdes. `prepare=yes` diz que a próxima fatia poderia ser preparada. `packet=ready-for-human-decision` diz que há material suficiente para uma decisão humana futura. `dispatch=no` é a fronteira dura: nenhuma execução pode começar por essa preview.

`stop=yes` e `oneSliceOnly=yes` são parte do contrato de segurança. Mesmo um futuro caminho explicitamente autorizado deve parar depois de uma fatia, registrar validação, commit e checkpoint, e só considerar outra iteração com contrato separado de repetição/cooldown/cancelamento.

Se o summary mostrar `packet=blocked dispatch=no`, trate como diagnóstico e não tente “forçar” execução. A correção deve ser voltar aos fatos locais: foco, checkpoint, git state, protected scopes, validation, stop conditions e handoff budget.

### Rehearsal local acumulado

A maturidade para trabalho ininterrupto seguro deve ser acumulada por rehearsal local, não por salto direto para automação. A evidência mínima já consolidada nesta lane é:

- baseline canônico de `.pi/settings.json` decidido e separado de overlays derivados;
- foco protegido stale removido da seleção default;
- readiness verde validada com `ready=yes` e `authorization=none`;
- preview one-slice validada nos caminhos verde e bloqueado;
- decision packet visível no summary compacto com `dispatch=no`;
- motivos de bloqueio visíveis como `packetReasons=...` somente quando o packet bloqueia;
- board, verificação, commit e checkpoint usados como fechamento explícito de cada fatia.

O próximo gate de maturidade para operar por períodos longos é um rehearsal de uma fatia por disparo: selecionar uma fatia local-safe, declarar rollback, executar só arquivos reversíveis, validar com gate conhecido, commitar escopo intencional, registrar board/checkpoint e parar. O sucesso de uma fatia não autoriza a próxima; repetição exige contrato separado.

Use `unattended_rehearsal_gate` apenas como evidência advisory/read-only. Um resultado `ready=yes` ou `ready-for-canary` nesse gate significa que a sequência local tem maturidade suficiente para discutir um canário controlado; não autoriza scheduler, self-reload, remote/offload, GitHub Actions, repetição automática ou execução sem decisão humana.

A fronteira de desbloqueio de potencial acumulado é: aumentar a capacidade de preparar, diagnosticar e fechar fatias com menos ambiguidade, mantendo controle humano sobre qualquer dispatch. Enquanto não houver tarefa separada com autorização explícita, rollback, limite de tempo/custo, cancelamento, cooldown e stop conditions, o modo ininterrupto permanece rehearsal local supervisionado.

Antes de qualquer executor, repetition ou scheduler depender de `.project` como autoridade operacional forte, use a estratégia em `docs/guides/project-canonical-pipeline.md#estratégia-de-longo-prazo-para-project`: `.project` é adapter local-first atual, hard intent apenas em lanes locais com ownership claro, e soft evidence/cache quando houver múltiplos escritores, adapters externos, CI/remote/offload ou stale focus.

### Contrato design-only de execução humana confirmada

A próxima fronteira antes de qualquer executor é um contrato explícito para uma única fatia local confirmada por humano. Esse contrato ainda é design-only: ele define condições mínimas, mas não cria executor aprovado.

Pré-condições mínimas:

1. summary live recente com `packet=ready-for-human-decision dispatch=no authorization=none`;
2. foco único `in-progress`, local-safe, com arquivos declarados e reversíveis por git;
3. rollback explícito: `git restore <arquivos>` ou equivalente não destrutivo para cada arquivo tocado;
4. validação conhecida antes da edição: smoke focal, `safe_marker_check` ou structured-read;
5. staging e commit intencionais: somente arquivos listados no contrato;
6. fechamento bounded: `board_task_complete` ou pacote de decisão quando fechamento automático não for adequado;
7. checkpoint obrigatório após a fatia;
8. stop obrigatório após uma fatia, mesmo se outra oportunidade estiver pronta.

A confirmação humana precisa nomear a tarefa e a ação, por exemplo: “autorizo executar uma fatia local para TASK-BUD-XYZ com os arquivos listados”. Uma frase genérica como “pode seguir” continua sendo autorização para continuar rehearsal/control-plane, não autorização para um executor.

Mesmo com confirmação explícita, o contrato só cobre uma fatia local. Ele não cobre scheduler, repetição automática, self-reload, remote/offload, GitHub Actions, publish, `.pi/settings.json`, `.github`, `.obsidian`, manutenção destrutiva de git ou qualquer escopo protegido. Cada um desses itens exige tarefa, gate e autorização separados.

Se qualquer pré-condição cair entre o packet e a execução — diff inesperado, teste desconhecido, checkpoint stale, protected scope, ambiguidade, contexto sem handoff fresco ou reload pendente — o contrato expira e volta para preview/readiness.

### Operator packet sem executor

`context_watch_one_slice_operator_packet_preview` é o pacote composto read-only para reduzir fricção sem liberar execução. Ele junta readiness, preview one-slice, decision packet e contract review em uma única linha de operador.

Caminho verde atual, ainda sem executor:

```text
context-watch-one-slice-operator-packet: readiness=yes preview=prepare-one-slice packet=ready-for-human-decision contract=blocked dispatch=no executor=no reasons=human-confirmation-missing authorization=none
```

Leia isso como: os fatos locais estão verdes, a fatia pode ser preparada, há decision packet suficiente para decisão humana, mas o contrato segue bloqueado porque a confirmação humana explícita não está presente. `dispatch=no` e `executor=no` continuam sendo fronteiras duras.

Caminho fail-closed por validação desconhecida:

```text
context-watch-one-slice-operator-packet: readiness=no preview=blocked packet=blocked contract=blocked dispatch=no executor=no reasons=packet-not-ready|human-confirmation-missing|validation-gate-missing authorization=none
```

Esse caso prova que o pacote não inventa validação; foco sem gate conhecido volta para diagnóstico.

Caminho com validação conhecida mas sem arquivos declarados:

```text
context-watch-one-slice-operator-packet: readiness=yes preview=prepare-one-slice packet=ready-for-human-decision contract=blocked dispatch=no executor=no reasons=human-confirmation-missing|declared-files-missing authorization=none
```

Esse caso prova que foco único não equivale a escopo reversível. `task.files` ou evidência equivalente precisa existir antes de qualquer execução futura.

O operator packet reduz fricção para jornadas longas porque coloca a evidência em uma linha, mas não substitui autorização. Ele não cobre repetition, scheduler, self-reload, remote/offload, GitHub Actions, protected scopes ou manutenção destrutiva.

### Gate de backlog para executor one-slice

Implementar um executor one-slice só entra na fila quando todos os critérios abaixo estiverem verdadeiros:

1. estratégia de `.project` resolvida para a lane atual: hard intent local ou soft evidence/cache com ownership claro;
2. `context_watch_one_slice_operator_packet_preview` live-validado em caminhos verde, fail-closed e missing-files;
3. contrato humano explícito definido por tarefa e ação, não confirmação genérica;
4. arquivos declarados e rollback não destrutivo para cada arquivo;
5. validação conhecida antes da edição;
6. escopo de staging/commit fechado e pequeno;
7. budget de tempo/custo definido;
8. cancelamento/abort seguro definido;
9. checkpoint pós-fatia obrigatório;
10. stop obrigatório depois de uma fatia.

“Vamos seguindo”, “pode continuar” ou confirmação genérica autorizam continuar control-plane/rehearsal, não implementar nem usar executor. A primeira implementação, se for escolhida em tarefa separada, deve nascer desabilitada ou dry-run/report-only, com `dispatchAllowed=false` até uma autorização separada de execução.

Esse gate cobre apenas executor local de uma fatia. Repetition, scheduler, self-reload, remote/offload, GitHub Actions, publish, escopos protegidos e manutenção destrutiva continuam fora de escopo e exigem gates próprios.

## Método de validação

Quando a fatia pode continuar mas o método de validação não está óbvio, use `validation_method_plan` como checagem curta. A regra operacional é:

- markers de texto devem ir para `safe_marker_check` ou `evaluateTextMarkerCheck`, não para shell inline;
- marker check shell-inline com sintaxe command-sensitive é caminho legado bloqueado pelo bash guard;
- teste focal só deve rodar quando o gate é conhecido e bounded;
- inspeção read-only deve usar structured-read quando aplicável;
- validação que toca escopo protegido ou exige mutação deve bloquear e pedir intenção explícita.

Registre o `summary` compacto da decisão quando ele explicar por que o método escolhido é seguro.

## Escada mínima para sinais simples

Sinais simples não devem acumular ruído nem virar desculpa para manutenção ampla. A decisão básica é:

1. observar e classificar o sinal;
2. corrigir na fatia atual se a solução for local-safe, pequena, reversível por git e tiver validação bounded;
3. registrar no checkpoint/board quando o sinal for relevante para continuidade;
4. pedir autorização explícita quando a solução for destrutiva, protegida, externa, custosa ou irreversível;
5. criar tarefa/decisão quando a solução exigir desenho, ownership, sync, migração ou política nova;
6. usar hardening quando o mesmo sinal se repetir.

“Simples” não significa “automático”. Simples significa que o custo de decisão é baixo, o blast radius é pequeno, o rollback é claro e a validação cabe na fatia. Se qualquer uma dessas condições faltar, a ação deixa de ser correção simples e vira task, decision packet ou pergunta ao operador.

Para manutenção git, a regra é conservadora: diagnosticar, registrar e recomendar são permitidos; executar `git gc`, executar `git prune` ou remover `.git/gc.log` exige autorização explícita. Um aviso de manutenção não deve ser ignorado, mas também não deve virar limpeza destrutiva automática.

Essa escada é parte da autonomia cultivada: reduzir hesitação e ruído, não aumentar gordura operacional. A resposta certa para um sinal pequeno deve ser curta e auditável; a resposta certa para um sinal estrutural deve virar tarefa estreita, não frente difusa.

## Testes de path cross-platform

Testes que validam paths devem ser agnósticos ao host. Quando a regra testada é formato canônico portátil, use fixtures literais com `/` e `\\` como strings de entrada e compare com evidência normalizada, em vez de montar expectativas com `path.join`, `path.resolve` ou separadores do sistema atual. O objetivo é provar que Windows, Linux e macOS chegam ao mesmo sinal medido, não que a suite passou por acidente no host local.

## Evidência mínima por fatia

Use uma linha curta:

```text
slice=<n> focus=<task> gate=<comando-ou-inspeção> commit=<sha> drift=<yes|no> next=<ação>
```

Essa linha deve ser suficiente para explicar continuidade sem inflar handoff, board ou docs.

### Final de turno com reload ou ação necessária

Quando uma fatia alterar runtime, registro de tool, surface ou comportamento que só aparece após `/reload`, o final de turno deve destacar claramente:

```text
**Reload necessário antes da validação live.**
```

Em seguida, liste próximos passos diretos em até 3 bullets, por exemplo:

```text
Próximos passos diretos:
1. fazer /reload;
2. pedir "reload feito, prossiga";
3. validar <tool/summary esperado>.
```

Quando não houver reload necessário, diga isso de forma curta se houver risco de dúvida: `Reload não necessário para a próxima fatia`. A regra é comunicação, não gate novo: ela não deve interromper trabalho local-safe nem pedir confirmação quando o próximo passo é óbvio e reversível.

Use o mesmo formato para outros bloqueios simples de continuidade: **ação necessária**, motivo em uma linha e próximos passos diretos. O objetivo é reduzir ambiguidade no fim do turno, não criar mais cerimônia.

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
