---
title: Control-Plane Operating Doctrine
description: Operating doctrine for unattended control-plane work.
---

# Doutrina operacional do control-plane unattended

Este guia consolida as opiniões operacionais que devem orientar o agente quando estiver trabalhando em modo local-first, com pouco atrito do operador, sem perder governança. Para nomenclatura canônica e aliases, use `docs/guides/control-plane-glossary.md` antes de criar novos termos ou surfaces.

## Norte

O objetivo não é automatizar tudo. O objetivo é manter trabalho contínuo, organizado e auditado, parando apenas quando houver risco real, decisão estratégica ou escopo protegido.

## Taxonomia de warning operacional (sessão vs monitor)

Para reduzir ruído e evitar resposta errada ao steer do operador:

- **warning de sessão/conversa**: aparece no runtime da sessão (ex.: `context-watch`, guidance de final-turn, notify de compact/reload). É sinal de experiência operacional imediata e deve ser calibrado por utilidade/ruído.
- **issue de monitor**: registro persistido em `.project/issues` por classifiers/monitores. É trilha histórica de qualidade/governança, não necessariamente ruído da sessão atual.

Regra prática:
1. se o steer do operador apontar ruído **na conversa**, priorizar ajuste no runtime da sessão (dedupe/cooldown/severidade adequada);
2. não tratar issue de monitor como prova de ruído da sessão sem evidência runtime;
3. quando houver confusão entre os dois, registrar nota curta no board para manter a taxonomia explícita.

## Princípios

1. **Local-first antes de remoto** — provar no PC local antes de GitHub Actions, remote runners, subagentes persistentes ou offload.
2. **Foco explícito governa a execução** — o foco atual vem do operador, do handoff ou de uma seleção local-safe registrada.
3. **Foco completo não é parada automática** — se existe uma próxima melhoria local, pequena, segura e óbvia, o agente deve continuar com uma nova fatia auditável.
4. **Checkpoint não é medo** — em `warn` ou `checkpoint`, salvar progresso e continuar bounded; em `compact`/warning final, parar a fatia atual e não iniciar nova run até checkpoint/auto-compact concluir.
5. **Board/handoff/verification são a autoridade** — docs e commits explicam, mas o estado operacional deve estar recuperável pelo board e handoff.
6. **Commits pequenos são uma guardrail** — cada fatia deve ter intenção clara, validação focal e staging limitado.
7. **Diagnóstico tem cadência** — evitar abrir pacotes de status por hábito; usar quando há reload, checkpoint, seleção, troubleshooting ou risco.
8. **Escopos protegidos exigem intenção explícita** — CI, GitHub Actions, remote execution, publish, `.pi/settings.json`, `.obsidian/` e pesquisa externa não entram por seleção automática.
9. **Inspirações são insumo, não desvio** — Squeez, mdt, impeccable.style e referências externas entram como tarefas explícitas e bounded.
10. **Qualidade vem de síntese, remoção e consistência** — preferir reduzir superfícies redundantes e consolidar opiniões antes de adicionar novas ferramentas.
11. **Unattended é malemolência com trilho** — continuar sozinho em fatias seguras, mas deixar rastro curto para auditoria e retomada.

### Checklist anti-gordura por fatia (máx. 8 itens)

Antes de iniciar ou fechar uma fatia, validar rapidamente:

1. **Uma intenção dominante** — a fatia resolve um problema principal, não três ao mesmo tempo.
2. **Sem duplicação sem ganho** — se repetir lógica/texto, justificar com contrato novo ou consolidar.
3. **Validação focal conhecida** — teste/marker/check de saída definido antes de editar.
4. **Rollback simples** — reversão por git ou revert local claro.
5. **Blast radius curto** — poucos arquivos e sem escopo protegido implícito.
6. **Semântica estável para consumo** — preferir `recommendationCode`/campos estruturados em vez de parsing textual.
7. **Evidência proporcional** — resumo curto e auditável; sem narrativa longa para mascarar incerteza.
8. **Parar no `no-eligible`** — ausência de próxima fatia local-safe é stop condition, não convite para drift.

Se 2+ itens falharem, a ação padrão é **decompor** (nova task/side quest) ou **parar** para foco explícito.

### Template de parking-note protegido (v1)

Quando uma task ficar parked por escopo protegido, usar um texto curto e canônico no board para reduzir variação semântica:

`[parking-template:v1] parked por escopo protegido; fora da seleção local-safe; requer foco explícito do operador.`

Regras:

1. manter o mesmo texto-base (só variar contexto se realmente necessário);
2. aplicar milestone de parking consistente (ex.: `protected-parked-legacy`);
3. não usar parking-note como autorização de execução; é só classificação operacional.

### Contrato de execução contínua por milestone (sem novo nome)

A unidade de execução contínua desta doutrina é o **milestone**. Não introduzir outro termo para “lote”: se a rodada é contínua, ela deve estar vinculada a um milestone explícito.

Condições de início da rodada (milestone):

1. existe `nextTaskId` local-safe elegível no milestone;
2. validação focal da primeira fatia é conhecida;
3. rollback da fatia é explícito.

Condições para continuar sem nova interação do operador:

1. fatia anterior fechou com validação focal e evidência curta;
2. próximo `nextTaskId` do mesmo milestone continua local-safe;
3. nenhum stop reason canônico foi acionado.

Para perfil de baixa interação do operador, encadear múltiplas fatias local-safe no mesmo milestone até stop condition real ou boundary de compactação, sem criar nomenclatura paralela.

Playbook curto para esse modo:

1. fechar a fatia com validação focal e evidência curta no board;
2. avançar para a próxima task local-safe elegível sem pedir novo nudge por task;
3. parar ao atingir stop condition canônica (especialmente `CONTEXT_COMPACT_REQUIRED`) e retomar após checkpoint/compact.

Regra de desacoplamento de planejamento: task local-safe não deve depender diretamente de task `protected-parked-*`; quando isso acontecer, replanejar dependências para pré-condição local-safe ou manter a task no fluxo protected.

Stop reasons canônicos (interação do operador obrigatória):

- `NO_ELIGIBLE_LOCAL_SAFE`
- `PROTECTED_SCOPE_REQUIRED`
- `BLOCKING_RELOAD_REQUIRED`
- `VALIDATION_FAILED`
- `AMBIGUOUS_OPERATOR_OBJECTIVE`

Evidência mínima por fatia (baixo custo de token):

- 1 registro de verificação focal no board;
- 1 nota curta de resultado/decisão na task;
- checkpoint/handoff curto quando a rodada segue ou pausa.

Evidência mínima por rodada de milestone:

- total de fatias concluídas;
- taxa de validação focal verde;
- contagem de stop reasons canônicos;
- próximos passos locais-safe ou razão explícita de parada.

### Escopo recomendado para run de manutenção em ondas (local-safe)

Para uma run maior sem perder governança, usar faixa de operação bounded:

- seed inicial entre 12 e 18 tasks `planned` local-safe;
- wave size de 4-6 tasks concluídas por rodada;
- no máximo 1 task `in-progress` no board por vez;
- cada task com blast radius curto (referência: até 4 arquivos e mudança pequena/reversível);
- no máximo 3 waves antes de checkpoint explícito do operador para recalibrar foco.

Gates de avanço entre waves:

1. validação focal verde em todas as tasks da wave;
2. nenhum blocker de escopo protegido acoplado ao plano local-safe;
3. checkpoint/handoff atualizado com resumo da wave;
4. contexto sob controle (sem pressão persistente de janela por diagnóstico volumoso).

Stop conditions adicionais para waves:

- 2 falhas seguidas de validação focal na mesma wave;
- surgimento de dependência local-safe -> protected durante a wave;
- drift de escopo (novas tarefas não planejadas sem justificativa bounded).

### Housekeeping anti-gordura para arquivos gigantes

Objetivo: manter o laboratório sustentável sem refactor cosmético. A regra é **coesão + contrato**, não “arrumadinho”.

Critério de entrada em wave de organização:

- arquivo com >1200 linhas **ou** manutenção recorrente com alto acoplamento;
- sinais de confusão operacional (ex.: mesma decisão espalhada em múltiplas surfaces);
- custo de leitura/revisão maior que o ganho da mudança funcional.

Contrato da wave (sem mudança comportamental):

1. extrair por domínio coeso (ex.: preview/readiness, auto-resume pós-reload, wiring de fila), nunca por recorte arbitrário;
2. preservar API/shape das tools e comandos existentes;
3. validar com smoke focal do domínio extraído;
4. manter rollback simples (commit pequeno, fácil de reverter).

Checklist pragmático por fatia de housekeeping:

- 1 extração pequena por vez (sem “big bang”);
- mesma suite de contratos verde antes/depois;
- dif semântica mínima (renome/realocação + cola de import);
- nota curta explicando por que a extração reduz acoplamento real.

### Hard intent anti-inchaço para surfaces TS (meta <=1000 linhas)

Direção estratégica: chegar a **<=1000 linhas** por surface TS como padrão sustentável. Isso é alvo arquitetural, não gatilho para refactor caótico.

Rollout faseado (sem travar fluxo local-safe agora):

1. **fase watch**: `1001-1400` linhas gera recomendação de extração planejada (`watch`);
2. **fase extract**: `1401-2000` linhas exige abrir fatia de extração coesa no milestone ativo (`extract`);
3. **fase critical**: `>2000` linhas vira prioridade arquitetural explícita, com wave dedicada e checkpoint por fatia (`critical`).

Regras hard-intent:

- **quando extrair**: se entrar em `extract|critical`, extrair por domínio coeso antes de adicionar nova lógica grande no mesmo arquivo;
- **quando adiar**: adiar só com justificativa curta e explícita (ex.: incidente crítico, release gate, blocker externo);
- **como registrar exceção**: adicionar nota canônica com `bloat-exception: <motivo curto> | prazo=<milestone|data> | owner=<task>`.

Guardrails de execução:

- sem mudança de contrato externo durante extração anti-inchaço;
- smoke focal obrigatório por fatia;
- rollback simples e imediato;
- sem auto-dispatch: promoção de wave continua decisão do operador.

### Calibração de substrato operacional (background + agents-as-tools)

Quando o control-plane estiver estável, o foco pode migrar para calibração do substrato operacional sem abandonar governança.

Ordem recomendada:

1. **background process observability/readiness** em modo report-only;
2. **agents-as-tools calibration** com score de governança/boundedness/observabilidade;
3. somente depois considerar contrato operacional mais forte, mantendo gates explícitos.

Regras de segurança dessa calibração:

- report-only first para novas surfaces;
- sem start/stop automático de processo fora de tarefa explícita;
- sem scheduler/remote/CI durante calibração local-safe;
- checkpoint por wave com decisão explícita de avançar/pausar.

### Contrato canário protected (uma fatia)

Quando houver decisão do operador para experimentar escopo protected, a execução deve começar em **uma única fatia canário** com contrato explícito e bounded.

Checklist obrigatório antes de editar:

1. `declaredFiles` bounded e intencionais;
2. `validationGate` focal conhecida;
3. `rollbackPlan` não-destrutivo;
4. `timebox` de uma fatia (sem repetição implícita).

Stop conditions canônicas do canário:

- falha de validação focal;
- falta de rollback explícito;
- violação de escopo declarado;
- necessidade de segunda fatia protected sem nova decisão do operador.

O canário é evidência de viabilidade, não promoção automática de escopo: cada nova fatia protected requer confirmação renovada do operador.

## Controle do Operador, Cancelamento e Blast Radius

Confiabilidade de cancelamento é pré-condição para qualquer modo longo ou unattended mais forte. Um `Esc` que não interrompe de forma previsível deve ser tratado como incidente de controle do operador, não como detalhe de UX. Até a causa estar classificada, a operação continua limitada a fatias locais, bounded e supervisionadas.

A investigação deve separar três camadas antes de atribuir culpa:

1. **Terminal/sandbox/host** — Windows Terminal, tmux, SSH, PTY, navegador remoto ou sandbox podem impedir que uma tecla chegue ao TUI. Se a limitação estiver nessa camada, registre workaround/fallback e não tente “consertar” configuração pessoal sem intenção explícita.
2. **Upstream pi/TUI** — o binding esperado é `app.interrupt=escape`; o TUI precisa receber o input, manter foco correto e encaminhar para `onEscape`. Durante streaming, compaction, retry, bash ou selectors, o handler pode trocar de significado e deve restaurar o estado anterior ao finalizar.
3. **Extensões e alquimias locais** — extensões podem registrar atalhos, widgets, editor customizado, terminal listeners ou ferramentas longas. Elas não devem capturar `Esc`, substituir o editor ou ignorar `AbortSignal` sem fallback visível.

A evidência mínima para classificar o incidente é curta: keybinding efetivo, presença/ausência de override pessoal, foco/estado do TUI no momento, caminho de abort chamado, e se a operação em curso respeita `AbortSignal` ou mata subprocesso/árvore de processo. Um resultado `ready` de qualquer gate continua sendo evidência, não permissão para executar mais tempo.

Em sessões deste repositório, considere ainda o launcher. O fluxo comum de desenvolvimento é `pnpm run pi:dev`, que chama `scripts/pi-isolated.mjs --dev`, define `PI_CODING_AGENT_DIR=.sandbox/pi-agent`, usa o CLI local oficial em `node_modules/@earendil-works/pi-coding-agent/dist/cli.js` e pausa o loop autônomo antes de iniciar. O namespace antigo `@mariozechner/pi-coding-agent` pode aparecer em arquivos históricos, mas não é fallback de runtime do `pi:dev`. Portanto, uma investigação não deve assumir que `~/.pi/agent` ou um pacote publicado representam a sessão live; confira launcher, `PI_CODING_AGENT_DIR`, sourceInfo de recursos e caminhos carregados antes de atribuir comportamento a upstream ou às extensões locais.

O perfil dev tem sane defaults do laboratório, mas pode ser trocado sem editar settings: `PI_DEV_MODEL_REF=provider/model pnpm run pi:dev` troca `defaultProvider`, `defaultModel` e `enabledModels` para uma sessão. Para escopos maiores, use `PI_DEV_ENABLED_MODELS=provider/a,provider/b pnpm run pi:dev`.

Checklist source-aware para `pi:dev`:

- confirmar `pnpm run pi:isolated:status` e registrar se o modo ativo é `isolated`;
- checar overrides de keybinding no sandbox (`.sandbox/pi-agent/keybindings.json`) além de `~/.pi/agent/keybindings.json`;
- listar somente os pacotes carregados que podem tocar input (`registerShortcut`, `setEditorComponent`, `onTerminalInput`, overlays) com busca curta e sem source maps;
- separar “tecla não chegou ao TUI” de “abort foi chamado, mas a operação não respeitou o sinal”.

Em ferramentas locais que executam subprocessos, `AbortSignal` deve ser repassado para a camada de execução (`pi.exec`/equivalente), mesmo quando há timeout. Timeout é limite temporal; cancelamento é controle imediato do operador. Se uma ferramenta longa não propaga o sinal, classifique como risco de controle do operador antes de habilitar uso unattended forte.

Status local da auditoria de cancelamento:

- `claude_code_execute` propaga o sinal recebido pelo tool para probes e subprocesso; esse caminho tem smoke test e validação dry-run após reload;
- ferramentas que apenas abrem URL, consultam status curto ou fazem diagnóstico passivo continuam aceitáveis com timeout curto, mas não são prova de cancelamento para long-run;
- comandos interativos/slash commands que disparam execução longa sem contrato explícito de cancelamento não devem ser usados como base para unattended forte;
- qualquer nova ferramenta que invoque subprocesso longo precisa declarar como propaga cancelamento e qual fallback operacional existe;
- drills de processo em background devem registrar a origem do stop/cancelamento como evidência separada: `stopSource=operator`, `stopSource=agent`, `stopSource=timeout` ou `stopSource=unknown`. Um `stopRequested=true` sem origem conhecida não basta para liberar unattended forte.

Drill local registrado em 2026-05-01: um subprocesso Node descartável foi iniciado só para teste (`DRILL_REGISTERED pid=33608`), recebeu stop controlado pelo agente (`DRILL_STOP_REQUESTED source=agent`) e concluiu com `DRILL_DONE code=null signal=SIGTERM`. A sequência canônica classificou `registered → running`, `stop-requested → stopped` com `stopSource=agent`, e o `done` posterior como `late-after-stop`, sem dispatch/autorização. Isso prova o caminho local de cancelamento controlado para processo filho descartável; não autoriza servers longos, scheduler, remote/offload nem kill de processo externo.

Pacote upstream/original do pi é superfície protegida. O repositório pode ler `node_modules/@earendil-works/pi-coding-agent` e `node_modules/@mariozechner/pi-coding-agent` para diagnóstico bounded, mas não deve editar, remover, sobrescrever ou aplicar mudanças diretas nesses pacotes instalados. Correções devem ser implementadas por extensão local, wrapper, patch controlado e auditável, ou PR upstream. O guardrail bloqueia mutações diretas por tools de edição/escrita e comandos shell mutantes conhecidos; leituras bounded seguem permitidas.

Skills confiáveis também são superfície de leitura operacional. Em devcontainers ou instalações globais, `SKILL.md` pode viver fora do workspace (por exemplo, em `~/.npm-global/lib/node_modules/@aretw0/...-skills/skills/<nome>/SKILL.md`). Leituras bounded de documentação Markdown dentro de roots de skills confiáveis não devem interromper o runtime com prompt de “leitura fora do projeto”; execução, instalação, scans recursivos e leituras arbitrárias fora do root da skill continuam exigindo bloqueio ou aprovação explícita.

Também existe controle do operador sobre o tamanho do diagnóstico. Investigações live não devem abrir saídas grandes, source maps ou scans amplos que empurrem a sessão para auto-compact. Use leitura por arquivo/offset, `head` estrito, `--exclude='*.map'` quando buscar em dependências, `safe_marker_check`/structured-read quando couber, e registre apenas a síntese operacional no board/handoff. Estouro de contexto por diagnóstico é incidente separado e deve virar hardening, não ruído aceito. O guardrail bloqueia scans de blast radius sobre source maps: leitura direta de `*.map` com ferramentas de conteúdo e varreduras recursivas em `node_modules`/`dist`/`build`/`coverage` sem exclusão explícita de `*.map` devem falhar antes de despejar saída no contexto.

Pesquisa remota bounded deve usar helper versionado, não receitas frágeis com variáveis shell embutidas. Para cache de repositórios de referência, prefira `bash packages/git-skills/skills/git-checkout-cache/checkout.sh <repo> --path-only`; para validar sem rede, use `--dry-run --path-only`. Evite comandos do tipo `CACHE=...; echo $CACHE` no `bash` tool, pois alguns harnesses podem interpolar `$VAR` antes de o comando chegar ao shell. Se o helper não estiver disponível, use caminhos literais curtos ou registre blocker Ops; não deixe uma falha de cache contaminar a conclusão da pesquisa principal.

Antes de promover nova pesquisa externa para foco protected, preencher intake local-safe curto (`docs/primitives/external-influence-intake-template.md`) com hipótese, valor/risco/esforço, canário e rollback. Esse intake prepara a decisão; não autoriza execução externa automática.

Para atualizações do Pi upstream/dependências, usar também `docs/guides/dependency-upstream-governance.md`: classificar `local-stack|upstream-pi|third-party-package|lockfile-resolution|mixed|unknown`, registrar package/lock diff, versão instalada, evidência externa quando disponível, arquivos nossos alterados, risco runtime, rollback e decisão `assimilate|hold|reject`. A decisão padrão continua `hold` quando faltar evidência; não há auto-update.

Janela mínima para assimilar influência externa (report-only, sem dispatch):

- **estoque local-safe validado** em nível saudável (mínimo configurado por run, default 3);
- **maturidade de validação** acima do piso (default 80% de cobertura em tasks local-safe);
- **sem bloqueio operacional crítico** (workspace sujo/reload pendente/readiness local bloqueada).

Quando o critério não fecha, a decisão padrão é `defer` (continuar throughput local-safe). Use `autonomy_lane_influence_assimilation_packet` para obter packet determinístico `ready-window|defer|blocked` com `authorization=none`. Mesmo em `ready-window`, a assimilação permanece protected e exige foco/decisão explícita do operador.

Bloqueios de stale-read (`File modified since read`) em ambientes de usuário devem virar incidente de triage, não desligamento de proteção. A política é falhar fechado para mutações com modelo mental defasado, mas oferecer recuperação mínima: re-read bounded do arquivo exato e re-aplicar a edição com anchors frescos. Se o bloqueio vier de superfície first-party/recomendada e for falso bloqueio com auto-format, criar teste/regra sem aceitar texto livre como prova de conteúdo atual. Ver `docs/primitives/stale-read-guard-incidents.md`.

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
| `Esc` não chega ao TUI ou não aciona abort | no-go para long-run | registrar camada terminal/TUI e usar fallback do operador |
| ferramenta ignora abort ou deixa subprocesso órfão | no-go até correção/teste | criar task de hardening antes de promover |

Critério mínimo para promover além de rehearsal bounded: pelo menos um caminho local de execução longa precisa ter cancelamento testado, fallback claro do operador, checkpoint prévio, saída limitada e decisão explícita do operador. Sem isso, o trabalho pode continuar em fatias locais pequenas, mas não em modo unattended forte.

### Pacote de maturidade da run local longa (report-only)

Para reduzir decisão subjetiva e evitar promoção por entusiasmo, use um pacote mínimo de métricas locais antes de falar em outros modos:

- `slicesCompleted` em batch (alvo inicial: 3-5);
- `focalValidationPassRate` (alvo: 100%);
- `unexpectedDirtyCount` (alvo: 0);
- `protectedAutoSelectionCount` (alvo: 0);
- `checkpointFreshnessViolations` (alvo: 0);
- `noEligibleStopHandled` (alvo: sempre tratado como stop condition);
- cobertura de board/handoff por fatia (alvo: 1 verification + checkpoint curto por fatia).

Interpretação:

- **go para novo rehearsal local**: métricas dentro do alvo no batch;
- **no-go para protected modes**: qualquer violação crítica de governança;
- **ação padrão no no-go**: abrir side quest local-safe de hardening e repetir o rehearsal.

Esse pacote mede maturidade operacional; ele não autoriza automaticamente scheduler, CI, remote/offload ou executor forte.

### Confirmação Auditável do Operador

Confirmação do operador para ação destrutiva/protegida precisa ser evidência auditável, não apenas sensação de UI. Se o operador aceitou um diálogo real da TUI, mas o monitor/guard posterior não vê evidência confiável no `tool_call`, em `custom_messages` ou em audit entry de origem runtime, classifique como **gap upstream pi/TUI → monitor**, preserve o bloqueio fail-closed e registre a incompatibilidade. Não relaxe `unauthorized-action` só porque a conversa contém uma frase de confirmação: isso é spoofable e não deve autorizar destructive/protected execution.

O contrato mínimo para usar confirmação como evidência futura é:

1. origem trusted/runtime, não texto livre do modelo;
2. vínculo com o mesmo tool/action/path/scope que será executado;
3. TTL curto e uso único;
4. audit entry preservada para guards/monitores e handoff;
5. falha fechada quando a confirmação não casa com a ação pendente.

A primitiva `resolveOperatorConfirmationAuditPlan` formaliza essa distinção em código: `uiConfirmationObserved=true` sem evidência monitor-visível retorna `decision=audit-gap`, `dispatchAllowed=false`, `canOverrideMonitorBlock=false` e `authorization=none`. Mesmo evidência trusted/exact-match retorna apenas `decision=auditable`; ela não executa nem aprova dispatch. A camada core também define `recordTrustedOperatorConfirmationUiDecision`, `resolveOperatorConfirmationEvidenceMatch`, `consumeTrustedOperatorConfirmationEvidence`, `consumeTrustedOperatorConfirmationAuditEnvelope`, `resolveOperatorConfirmationRuntimeConsumptionPlan` e `resolveOperatorConfirmationSignalSourcePlan` para transformar uma decisão trusted de UI em evidência curta, fazer TTL, match exato de `toolName`/path/scope/payload, consumo single-use, decidir se o consumidor tem dados estruturados suficientes e escolher entre guard-owned audit entry, wrapper ou proposta upstream. Isso prepara a ponte runtime sem tornar texto livre ou confirmação stale em autorização. O envelope `buildTrustedOperatorConfirmationAuditEnvelope` usa `customType=operator-confirmation-evidence`, `display=false`, resumo bounded e `dispatchAllowed=false`/`canOverrideMonitorBlock=false`; consumidores devem validar `details` estruturado e recusar conteúdo textual spoofable. Se o monitor só enxerga `custom_messages` textual, isso não basta; é necessário bridge runtime estruturado, guard que possui o diálogo, ou sinal upstream/wrapper. O `guardrails-core` já registra esse envelope como audit entry para confirmações UI de leitura sensível/fora do projeto, preservando o comportamento existente de permitir/bloquear conforme o diálogo, mas agora com rastro trusted para futura leitura por monitores/guards. Para confirmações destrutivas upstream que acontecem antes do `tool_call`, o caminho seguro é PR/wrapper que exponha sinal estruturado; patch direto em `node_modules/@earendil-works/pi-coding-agent` ou `node_modules/@mariozechner/pi-coding-agent` segue proibido. O contrato de sinal fica em `docs/primitives/operator-confirmation-signal.md`. O primeiro canal local deve ser `guard-owned-report-only`: gravar evidência estruturada sem habilitar diálogo destrutivo operacional, sem dispatch e sem override, até uma tarefa separada autorizar implementação live.

## Controle de processos em background

Projetos que usam pi para desenvolvimento local frequentemente precisam subir frontend, backend, workers ou servidores de teste. Isso é uma superfície crítica antes de loops longos: o agente precisa saber o que iniciou, em qual workspace, com qual owner/session, em qual porta, como parar/reiniciar e como coletar erro sem despejar logs grandes no contexto.

A direção para a primitiva futura é local-first e governada: processos devem ter metadata de owner/workspace/session, lease/lock de porta, lifecycle explícito (`launch`, `status`, `tail`, `stop`, `restart`), captura bounded de stdout/stderr/stacktrace e cleanup seguro em reload/compact/handoff. Logs devem ser consultados por tail, filtro e resumo estruturado, nunca por dump bruto.

A política deve suportar dois modos sem impor opinião única: serviço compartilhado por workspace quando faz sentido reutilizar um único server para testes, e workers isolados/paralelos quando trabalhos diferentes realmente precisam rodar lado a lado. Em ambos os casos, colisão de portas, processos órfãos, subprocessos zumbis e testes concorrentes com o mesmo server devem falhar fechado ou pedir decisão explícita.

A primeira superfície dessa direção é `background_process_plan`, uma primitiva read-only de planejamento. Ela define metadata, port lease, modo compartilhado/isolado, logs bounded e bloqueios de restart destrutivo, mas ainda não lança, para, reinicia ou reserva portas. O contrato detalhado fica em `docs/primitives/background-process-control.md`.

Enquanto a primitiva operacional completa não existir, não iniciar servers/background longos automaticamente; preferir comandos curtos, status bounded e parada manual explícita.

Curadoria atual (decisão explícita): remover `@ifi/oh-pi-extensions/extensions/bg-process.ts` da instalação padrão e operar com primitivas first-party (`background_process_plan`, `background_process_lifecycle_plan`, `background_process_readiness_score`, `background_process_rehearsal_gate`) para evidência report-only sem UI ruidosa.

## Higiene de tools antes de loops grandes

Antes de qualquer loop grande, a stack deve tratar tools expostas como superfície de risco. A primitiva `tool_hygiene_scorecard` é read-only e classifica tools como `advisory`, `measured`, `operational`, `protected` ou `development`, sinalizando flags como mutação, scheduler, remote/CI, settings/profile, subprocesso e override manual. O resultado mantém `authorization=none` e `dispatchAllowed=false`.

A promoção é conservadora: tools advisory/measured podem permanecer visíveis para fatias locais bounded; tools operational exigem evidência medida e vínculo explícito com task; tools protected exigem aprovação do operador e não entram em auto-dispatch; tools de development com subprocesso devem ser ocultadas/desabilitadas antes de loops longos salvo debugging explícito. O scorecard é evidência de higiene, não permissão para executar.

Snapshot local de 2026-05-01 antes do rehearsal: `tool_hygiene_scorecard` listou 102 tools, com 47 advisory, 44 measured, 5 operational e 6 protected; 8 requerem aprovação do operador e nenhuma está marcada para esconder automaticamente antes de loop longo. Decisão de curadoria para rehearsal local: manter tools advisory/measured visíveis para fatias bounded; permitir tools operational de board/checkpoint apenas com task/verificação explícitas; manter `ant_colony`, `claude_code_execute`, `schedule_prompt`, `safe_boot`, `governance_profile` e `handoff_advisor` como protected/no-auto-dispatch. `stack_sovereignty_status` apontou 3 riscos médios e um overlap ativo `oh-pi-bg-process-future` com `strategy=needs-decision`; nenhuma capability third-party deve ser removida/suprimida automaticamente sem decisão explícita. Isso é go para rehearsal local bounded, mas no-go para unattended forte sem decisão posterior sobre overlaps de background/scheduler/runtime.

## Roteamento local de cota

Roteamento de provider é uma superfície de continuidade, mas também é settings/provedor protegido. A regra local-first é: inventariar primeiro, gerar patch preview, e só aplicar mudança de provider/model com intenção explícita. `quota_visibility_route` e `handoff_advisor` ficam `noAutoSwitch=true` salvo `execute=true` pedido pelo operador.

Inventário read-only recomendado antes de qualquer mudança de rota:

- `.pi/settings.json`: baseline canônico do projeto, com `defaultProvider/defaultModel` protegidos por decisão explícita do operador;
- settings derivados ou sandbox do agente: confirmar de onde a sessão live lê provider/model antes de atribuir comportamento;
- `provider_readiness_matrix`: provider/model ativo com readiness e budget scope; quando houver budget `provider/model`, esse escopo deve prevalecer sobre o orçamento genérico do provider;
- `quota_visibility_route(profile=balanced, execute=false)`: deve produzir recomendação e `noAutoSwitch=true`;
- `handoff_advisor(execute=false)`: deve produzir recomendação e `noAutoSwitch=true`.

Patch preview seguro pode ser **no-op** quando a rota atual já está saudável ou quando o provider alternativo não tem readiness/budget/login claro. Um preview futuro só pode ser produzido após o operador declarar provider/model exatos e confirmar que a conta/provedor está disponível sem custo/uso extra inesperado, por exemplo em forma auditável:

```json
{
  "defaultProvider": "anthropic-ou-github-copilot",
  "defaultModel": "modelo-declarado-pelo-operador",
  "piStack": {
    "quotaVisibility": {
      "routeModelRefs": {
        "provider-atual": "provider-atual/model-declarado",
        "anthropic-ou-github-copilot": "provider/model-declarado"
      }
    }
  }
}
```

Retorno a qualquer perfil anterior também é manual: usar `/model` ou `quota_visibility_route({ "profile": "balanced", "execute": true })` somente quando o operador pedir explicitamente e quando o advisor ainda mostrar a rota alvo em estado aceitável. Classificadores/monitores leves permanecem na rota configurada enquanto houver cota; se ela entrar em WARN/BLOCK, registrar handoff advisory e pedir decisão em vez de auto-switch.

## Intent Intake, Entrevistas Estruturadas e Gaps do Operador

Gaps do operador devem ser preenchidos por contrato backend-first antes de qualquer UI. Para intenção livre, comece por `operator_intent_intake_packet`: ele classifica a próxima rota report-only (`structured_interview_plan`, `lane_brainstorm_packet`, `control_plane_profile_packet`, readiness de runtime/worker ou `agent_run_operator_packet` só após readiness explícita) e devolve `details.interaction` com `uiHints.preferred=choice-list`, `recommendedChoiceId`, escolhas que a TUI pode renderizar, resposta customizada e cancelamento. Quando `details.operatorPromptRequired=true`, deve perguntar ao operador ou parar. Quando a intenção for apenas validar saúde do runtime antes do trabalho, passar o texto do operador basta; a intake infere `runtime_health_requested=true` a partir de pedidos de runtime health, watchdog ou `/watchdog:*` e vai direto para checks read-only, não para confirmação. `needs-evidence` nesse caminho é pedido de evidência mínima, não `stop-and-investigate`; parar exige blocker real, escopo protegido, mutação insegura ou degradação ativa. Quando a intenção for saber se workers/subagentes estão prontos ou seguros, a intake infere `worker_readiness_requested=true` e roda readiness read-only sem preparar nem despachar worker; orçamento só entra ao preparar pacote de worker ou dispatch. Quando safe-mode do watchdog estiver ativo, manter a rota em diagnóstico read-only ou uma fatia local-safe pequena e bloquear escalation para worker dispatch, pi-lens, web gateway, remote/offload ou publish até estabilidade ou decisão explícita nova. Quando a intenção pedir próxima fatia local-safe, indicar `no-eligible` ou pedir seed/brainstorm do board, a intake infere a rota `lane_brainstorm_packet` + `lane_brainstorm_seed_preview` sem materializar task; intenção genérica ainda passa por entrevista curta. A intake não autoriza mutação, worker nem dispatch.

Quando a intake retornar `reportOnlyRouteAuthorized=true` (`controlPlaneAction=run-report-only-route`, `confirmationRequired=false` e `operatorDecisionNeeded=false`), o control-plane deve executar as ferramentas reais nomeadas em `details.executionPlan.steps` em ordem e resumir os `details` retornados. Não responder por memória, inferência livre ou texto parecido com o packet. Se uma ferramenta nomeada não estiver disponível, retornar `blocked_missing_tool` com o nome faltante em vez de sintetizar o resultado. Se `executionPlan.executeWithoutTextualConfirmation=true`, não pedir confirmação textual para um packet que não muta estado, não despacha worker e não cria autorização.

Quando a rota exigir perguntas, a primitiva `structured_interview_plan` recebe uma lista de perguntas com ids estáveis, tipo, obrigatoriedade, opções, defaults e flags `allowUnknown`/`allowSkip`; recebe respostas parciais; valida sequencialmente; e devolve `complete`, `needs-operator-answer` ou `invalid` com `nextQuestionId` e evidência compacta.

Essa primitiva é deliberadamente UI-independent: não abre formulário, não agenda repetição, não despacha executor e mantém `authorization=none` e `dispatchAllowed=false`. TUI, web, Telegram ou forms podem ser adaptadores futuros sobre o mesmo contrato, mas não são a fonte de verdade. Defaults, `unknown` e `skip` só contam quando declarados no schema da pergunta; escolhas inválidas e skips não autorizados falham fechado.

Use esse contrato para preencher lacunas de decisão em revisão do operador, contrato one-slice, no-auto-close e gates de execução local. Um resultado `complete` é evidência estruturada, não permissão operacional automática.

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

## Discussões laterais rápidas (`/btw`)

`/btw` permanece em fase de pesquisa/curadoria, não como prompt first-party canônico. Antes de expor uma versão própria, compare a prior art instalada e remota. `@ifi/oh-pi-extensions/extensions/btw.ts` implementa `/btw` e `/qq` como conversa lateral em widget, mantém thread separada fora do contexto principal, e só injeta de volta por comandos explícitos (`/btw:inject`, `/btw:summarize`). A skill `@ifi/oh-pi-skills/skills/btw/SKILL.md` documenta também `/btw:new`, `/btw:clear` e `--save`. A referência remota `mitsuhiko/agent-stuff/extensions/btw.ts` também implementa `/btw` como extensão runtime: overlay de side-chat, `AgentSession` separada em memória, thread persistida por custom entries e injeção de summary no chat principal.

Contrato desejado para qualquer versão futura: canal conversacional/advisory, sem trocar foco atual por padrão, sem executar mudanças automaticamente e sem disparar comandos, staging, commit, scheduler, remote/offload ou manutenção destrutiva. Se a lateral virar trabalho real, capture como decisão/backlog apenas com pedido explícito do operador e por superfície bounded (`board_task_create`, `board_update` ou bloco de decisão), mantendo o handoff/foco principal preservado.

Não publique `packages/lab-skills/prompts/btw.md` nem manifeste `pi.prompts` para `/btw` até haver decisão explícita de design. A matriz curatorial fica em `docs/research/btw-curatorial-design-matrix-2026-05-01.md`: comparar decisões de `oh-pi`, `mitsuhiko/agent-stuff`, `dbachelder/pi-btw` e outras referências conhecidas; então escolher entre reutilizar, adaptar/wrappar, filtrar uma extensão existente, criar runtime first-party opt-in, ou manter apenas docs/skill.

## Reconciliação de estado por modo

Execução ininterrupta só é segura quando o estado consegue ser reconciliado por modo/canal. A política detalhada fica em `docs/primitives/state-reconciliation-modes.md`: `native/direct-branch` é o default local; `pull-request`/`merge-request` são canais de promoção revisável, não autorização para CI/remoto; board/handoff usam superfícies bounded; `.pi/settings.json` permanece baseline protegido; múltiplos escritores exigem single-writer ou generated apply step antes de qualquer loop forte.

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

### Contrato hard-intent para auto-advance da lane AFK (low-iteration)

A continuidade entre tasks local-safe não deve depender de “soft intent” implícito. Aqui, **AFK** significa produção com baixa iteração do operador (away from keyboard), independente de horário. O contrato runtime da lane AFK é:

1. quando o foco do handoff termina (`focus-complete`), a seleção pode auto-avançar para a próxima task elegível da mesma lane/milestone;
2. o auto-advance é **fail-closed**;
3. não há auto-advance quando qualquer bloqueio crítico aparecer.

Bloqueios críticos mínimos:
- `protected` (task sucessora com sinal de escopo protegido);
- `risk` (sinal de risco destrutivo/irreversível);
- `reload-required` ou workspace não limpo;
- `validation-failed-or-unknown`.

Quando bloqueado, a recomendação deve voltar para escolha explícita de foco do operador (`choose-next-focus`) com motivo auditável no texto/recommendationCode.

No uso AFK, opere em batch pequeno (3–5 fatias) com `commit + checkpoint` por fatia. Se qualquer blocker hard-intent aparecer, pare no mesmo slice e registre linha curta de stop (`stop: <motivo>`) antes de retomar.

### Gate de promoção para simple-delegate rehearsal

A próxima promoção após estabilizar a lane local-safe deve passar por packet report-only explícito (`simple_delegate_rehearsal_packet`). Para reduzir ambiguidade de leitura, primeiro consulte `delegation_readiness_status_packet` (agora com `operationalRunway` consolidando delegação + background em `local-execute|simple-delegate|defer` e blockers normalizados) e depois confirme no packet de rehearsal. O gate mínimo:
- `decision=ready-simple-delegate` no status unificado **e** `decision=ready` no packet composto (capability + mix + auto-advance telemetry);
- blockers vazios;
- escopo protegido ainda opt-in do operador.

Se o packet retornar `needs-evidence|blocked`, a regra é não promover. Continuar em local-safe até o próximo checkpoint com evidência adicional.

Canário one-task (simple-delegate) — contrato mínimo explícito:
- foco único de task;
- `declared_files_known=true`;
- `validation_gate_known=true`;
- `rollback_plan_known=true`.

Exemplo de packet (report-only):

```text
simple_delegate_rehearsal_start_packet {
  declared_files_known: true,
  validation_gate_known: true,
  rollback_plan_known: true
}
```

Interpretação operacional:
- `decision=blocked`: manter lane local-safe e fechar gaps de rehearsal/capability;
- `decision=ready-for-operator-decision`: canário apto para decisão explícita do operador (`start|abort|defer`), sem auto-dispatch.

### Material-first para long run AFK

Controle e auditoria não bastam sem material. Antes de tentar um ciclo AFK longo, garantir abastecimento explícito do board:
- gerar ideias com `lane_brainstorm_packet` (report-only);
- revisar semeadura com `lane_brainstorm_seed_preview` (decisão explícita do operador);
- materializar um lote local-safe curto e verificável no board;
- manter estoque operacional de **3–7 fatias** local-safe prontas.

Sem esse abastecimento, a lane deve preferir limpeza/triagem/pesquisa bounded para criar próximas fatias em vez de forçar continuidade vazia.

Para medição read-only dessa prontidão, usar `autonomy_lane_material_readiness_packet` (`continue|seed-backlog|blocked`) antes de ampliar ciclos AFK. Para execução contínua de várias horas, usar também `autonomy_lane_batch_preview` (report-only): fila bounded de 3-7 slices local-safe com `validationGate` e `rollback` curtos por slice, sempre com `authorization=none`.

#### Contrato hard/soft intent para batch lane

Use `autonomy_lane_batch_preview` como superfície de trabalho e aplique o contrato abaixo:

- **hard-intent batch gates (bloqueantes):** `protected scope`, risco destrutivo/irreversível, `reload-required-or-dirty`, validação focal ausente/desconhecida, ou blocker operacional explícito.
- **soft-intent batch preferences (direção):** manter batch pequeno, reduzir ruído de handoff, priorizar slices de maior desbloqueio e adiar assimilação externa enquanto stock local-safe estiver baixo.

Decisão operacional no batch lane:

1. **quando continuar sozinho:** preview `decision=ready`, gates hard-intent limpos, e fila local-safe suficiente;
2. **quando checkpointar:** após cada slice concluído (commit pequeno + checkpoint bounded) ou antes de fronteira de compact;
3. **quando pausar para decisão estratégica:** qualquer blocker hard-intent, necessidade de escopo protegido, ou conflito entre caminhos estratégicos.

Quando a lane cair em `no-eligible-tasks`, ler `seedingGuidance` no `autonomy_lane_status` (mesmos sinais de `seedWhy` + `seedPriority`) para decisão rápida. O próprio `summary` do status também deve carregar esse cue curto (`code/next/queue` + `seedCount/seedWhy/seedPriority` quando houver) para reduzir nudge operacional, e o `nextAction` pode vir enriquecido com diretiva direta (`seed <n> local-safe ...`). Além disso, acompanhar `influenceWindowCue` e `protectedReadyCue` no status para saber quando a janela protected está `ready-window` com candidato elegível, sem abrir packet separado a cada ciclo. Quando quiser um gatilho único, usar `decisionCue` (`seed-local-safe-required` ou `protected-focus-ready`) para saber se há decisão pendente do operador. Em compact com `reload-required`, tratar supressão de auto-resume como defer temporário: persistir intent no handoff e reavaliar dispatch após `/reload`, mantendo gates de checkpoint/board/queue fail-closed; quando houver intent pendente, `context_watch_status`, `context_watch_continuation_readiness` e `context_watch_local_slice_preview` devem sinalizar `postReloadResume=pending` no summary curto. Se precisar detalhe completo, usar `autonomy_lane_material_seed_packet` (`seed-now|wait|blocked`) e `autonomy_lane_influence_assimilation_packet`. Ao reseedar, registrar `seedWhy`/`reseedJustification`, `seedPriority` e `seedCount` no fechamento curto para manter motivo auditável e prioridade de longo prazo explícita.

Stop condition para estoque baixo:
- `stop: backlog-material-insuficiente`.

No checkpoint/handoff AFK, preferir template curto material-first:
- `afk-handoff: decision=<continue|seed-backlog|blocked> stock=<validationKnown>/<target> blockers=<lista-curta|none> next=<ação-segura>`.

Préflight de capacidade da máquina para long-run deve consultar `machine_maintenance_status` com sinais de memória/disco/CPU. Em `warn|pause|block`, reduzir para fatias bounded e evitar acelerar batches até recuperar headroom.

### Fila pós-calibração

Após fechar uma macro-task de calibração, não puxe backlog protegido só para manter movimento. Em 2026-05-01, depois de `TASK-BUD-153`, `TASK-BUD-405` e `TASK-BUD-416`, `autonomy_lane_next_task` sem escopos protegidos retornou `no-eligible-tasks`: 8 candidates, 4 bloqueados por dependência e 4 pulados por escopo protegido. As classes restantes eram promotion/recovery de colony, GitHub Actions/remote/release, research/config inspiration e tarefas dependentes.

Regra de continuidade: `no-eligible-tasks` é um stop condition local, não convite para invadir protected scope. O agente deve escolher uma destas saídas auditáveis:

1. rodar `operator_intent_intake_packet` com a intenção do operador e, quando for seed de próxima fatia, seguir `lane_brainstorm_packet` + `lane_brainstorm_seed_preview` em modo report-only antes de materializar qualquer task;
2. pedir decisão do operador para promover backlog protegido/ambíguo;
3. deferir e registrar checkpoint quando não houver próxima fatia local-safe útil.

Promotion/recovery de colony exige inventário/validação própria e revisão do operador; GitHub Actions, release, remote/offload e publish exigem tarefa protegida explícita; research/config inspiration só entra como inspiração bounded quando for selecionada pelo operador. Nenhuma dessas classes deve ser selecionada por continuidade automática local.

A exceção local-safe é preparar um packet read-only, como `docs/primitives/colony-promotion-decision-packet.md`, para um único candidate `*-promotion`. Esse packet pode inventariar arquivos, validação focal, riscos e opções do operador `promote`/`skip`/`defer`, mas deve preservar `mutationAllowed=false`, `dispatchAllowed=false` e `authorization=none`. Se a opção do operador for `promote`, a materialização continua sendo uma fatia protegida separada, nunca uma continuação automática do packet.

Pacote de decisão local de 2026-05-01 para o backlog restante:

| Classe | Exemplos no board | Decisão segura |
| --- | --- | --- |
| Colony promotion/recovery | `colony-c1-promotion`, `colony-c2-promotion`, `colony-c-123-promotion`, `colony-c-ret-1-promotion` | Não promover automaticamente. Exigir inventário de arquivos, validação focal e revisão do operador antes de materializar candidate no branch alvo. |
| Remote/CI/release | `TASK-BUD-134`, `TASK-BUD-136` | Escopo protegido. Só entra com tarefa/decisão explícita, rollback, budget de custo/tempo e sem auto-dispatch. |
| Inspiração/research/config | `TASK-BUD-162`, `TASK-BUD-268` | Opt-in bounded. Não iniciar pesquisa externa ampla nem mutar config; primeiro criar pergunta/artefato local claro. |
| Dependentes/bloqueadas | tarefas planejadas com `depends_on` não resolvido | Não selecionar até dependencies concluídas ou reescopadas por decisão do operador. |

Próximas decisões do operador possíveis, sem executar escopo protegido:

1. autorizar uma revisão bounded de um único `*-promotion` de colony, começando por inventário read-only e decision packet, sem aplicar no branch;
2. autorizar uma lane protegida para CI/release/remote com contrato próprio;
3. escolher uma inspiração bounded (`TASK-BUD-162` ou `TASK-BUD-268`) e limitar a saída a um resumo local sem rede ampla/sem settings mutation;
4. criar uma nova fatia local-safe de hardening/limpeza se o objetivo for continuar sem tocar backlog protegido.

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

A superfície `self_reload_autoresume_canary` é apenas plano read-only: mesmo com todos os gates verdes retorna `reloadAllowed=false`, `autoResumeDispatchAllowed=false`, `dispatchAllowed=false`, `authorization=none` e `decision=ready-for-operator-decision`. Ela existe para auditar maturidade do contrato antes de qualquer implementação protegida de reload real; não executa `/reload`, não agenda resume e bloqueia em pending messages, recent steer, lane queue, escopos protegidos, remote/offload, GitHub Actions ou manutenção destrutiva.

## Loop local sem empurrões manuais

Os empurrões manuais do operador ainda substituem um idle continuation loop seguro. O canário futuro desse loop só deve continuar sozinho quando conseguir selecionar a próxima fatia local-safe, gravar checkpoint bounded fresco, respeitar orçamento do handoff, confirmar git state esperado, evitar escopos protegidos, aplicar cooldown, executar validação/smoke conhecido e parar em stop conditions reais. O contrato operacional mais simples fica em `docs/primitives/nudge-free-local-continuity.md`: não cria um nome novo; trata “overnight” como cenário/alias de `nudge-free` / `local continuity audit`, com batch local pequeno, 3-5 fatias, commit/checkpoint por fatia, sem scheduler/remote/offload.

Stop conditions reais incluem risco de perda de dados, escopo protegido, ambiguidade de produto, falha sem correção local óbvia, compact sem progresso salvo, reload sem contrato aprovado ou handoff inválido. Até esse canário existir, a continuidade sem empurrões permanece backlog explícito, não automação implícita.

### Prova verde de readiness local

Um `ready=yes` em `context_watch_continuation_readiness` é evidência read-only, não permissão operacional. Ele não inicia scheduler, loop unattended, self-reload, remoto, offload, compact ou resume por conta própria; a saída deve continuar mostrando `authorization=none`.

A primeira prova verde local só vale quando as condições observáveis estão limpas: baseline canônico de settings já decidido, escopos protegidos fora do foco default, foco `in-progress` pequeno/local-safe, checkpoint fresco sem blockers reais, git state esperado, validation conhecida e smoke/readiness focal passando. Se qualquer uma dessas condições cair, o gate deve voltar a falhar fechado.

Rehearsal local medido de 2026-05-01: `unattended_rehearsal_gate` retornou `ready=yes`, `decision=ready-for-canary`, `score=6/6` para 5 fatias locais concluídas com foco preservado, smoke focal verde, commits pequenos, handoff fresco, 0 seleções automáticas de escopo protegido e 0 blockers locais restantes. Esse sinal é suficiente para considerar o rehearsal local dos blockers resolvido, mas não fecha sozinho a macro-task multi-modo: `local_continuity_audit` e `context_watch_continuation_readiness` continuaram `ready=no` porque o foco amplo `TASK-BUD-153` ainda referencia escopo protegido `.github/workflows/ci.yml`. Portanto, a próxima promoção precisa de decisão do operador de reescopo/fechamento ou tarefa explícita para o canal protegido; nada disso autoriza scheduler, remote/offload ou GitHub Actions automático.

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
context_watch_local_slice_preview: decision=prepare-local-slice prepare=yes stop=yes singleSliceOnly=yes packet=ready-for-operator-decision dispatch=no ... authorization=none
turn_boundary_decision_packet: ... growthDecision=go|hold|needs-evidence growthCode=... authorization=none
```

Leia essa saída como evidência graduada, não como permissão. `ready=yes` diz que os fatos locais observados estão verdes. `prepare=yes` diz que a próxima fatia poderia ser preparada. `packet=ready-for-operator-decision` diz que há material suficiente para uma decisão futura do operador. `growthDecision=...` explicita se o boundary está em faixa de expansão (`go`) ou estabilização (`hold|needs-evidence`). `dispatch=no` é a fronteira dura: nenhuma execução pode começar por essa preview.

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

Use `unattended_rehearsal_gate` apenas como evidência advisory/read-only. Um resultado `ready=yes` ou `ready-for-canary` nesse gate significa que a sequência local tem maturidade suficiente para discutir um canário controlado; não autoriza scheduler, self-reload, remote/offload, GitHub Actions, repetição automática ou execução sem decisão do operador.

A fronteira de desbloqueio de potencial acumulado é: aumentar a capacidade de preparar, diagnosticar e fechar fatias com menos ambiguidade, mantendo controle do operador sobre qualquer dispatch. Enquanto não houver tarefa separada com autorização explícita, rollback, limite de tempo/custo, cancelamento, cooldown e stop conditions, o modo ininterrupto permanece rehearsal local supervisionado.

Antes de qualquer executor, repetition ou scheduler depender de `.project` como autoridade operacional forte, use a estratégia em `docs/guides/project-canonical-pipeline.md#estratégia-de-longo-prazo-para-project`: `.project` é adapter local-first atual, hard intent apenas em lanes locais com ownership claro, e soft evidence/cache quando houver múltiplos escritores, adapters externos, CI/remote/offload ou stale focus.

### Qualidade de tickets e side quests explícitas

Tarefas pequenas/local-safe podem fechar com verificação focal simples. Tarefas macro, amplas, protegidas, rationale-sensitive ou com muitos arquivos/critérios precisam de decomposição explícita antes de fechamento. Se durante a execução surgir uma dependência real, ela deve virar subtask/side quest no board, com `depends_on`, acceptance criteria e verificação própria esperada; não deve permanecer implícita em conversa ou handoff.

Use uma checagem bounded/read-only de qualidade de ticket antes de fechar tarefas amplas. O sinal deve distinguir rigidez útil de burocracia: `small-task-no-dependencies-ok` é aceitável para tarefas pequenas, enquanto `macro-task-missing-dependencies`, dependência inexistente, verificação parcial usada como fechamento ou tarefa concluída sem verificação passada bloqueiam fechamento automático e exigem decomposição ou decisão explícita.

### Contrato Design-Only de Execução Confirmada pelo Operador

A próxima fronteira antes de qualquer executor é um contrato explícito para uma única fatia local confirmada pelo operador. Esse contrato ainda é design-only: ele define condições mínimas, mas não cria executor aprovado.

Pré-condições mínimas:

1. summary live recente com `packet=ready-for-operator-decision dispatch=no authorization=none`;
2. foco único `in-progress`, local-safe, com arquivos declarados e reversíveis por git;
3. rollback explícito: `git restore <arquivos>` ou equivalente não destrutivo para cada arquivo tocado;
4. validação conhecida antes da edição: smoke focal, `safe_marker_check` ou structured-read;
5. staging e commit intencionais: somente arquivos listados no contrato;
6. fechamento bounded: `board_task_complete` ou pacote de decisão quando fechamento automático não for adequado;
7. checkpoint obrigatório após a fatia;
8. stop obrigatório após uma fatia, mesmo se outra oportunidade estiver pronta.

A confirmação do operador precisa nomear a tarefa e a ação, por exemplo: “autorizo executar uma fatia local para TASK-BUD-XYZ com os arquivos listados”. Uma frase genérica como “pode seguir” continua sendo autorização para continuar rehearsal/control-plane, não autorização para um executor.

Mesmo com confirmação explícita, o contrato só cobre uma fatia local. Ele não cobre scheduler, repetição automática, self-reload, remote/offload, GitHub Actions, publish, `.pi/settings.json`, `.github`, `.obsidian`, manutenção destrutiva de git ou qualquer escopo protegido. Cada um desses itens exige tarefa, gate e autorização separados.

Se qualquer pré-condição cair entre o packet e a execução — diff inesperado, teste desconhecido, checkpoint stale, protected scope, ambiguidade, contexto sem handoff fresco ou reload pendente — o contrato expira e volta para preview/readiness.

### Operator packet sem executor

`context_watch_local_slice_operator_packet_preview` é o pacote composto read-only para reduzir fricção sem liberar execução. Ele junta readiness, preview local-slice, decision packet e contract review em uma única linha de operador.

Caminho verde atual, ainda sem executor:

```text
context-watch-one-slice-operator-packet: readiness=yes preview=prepare-one-slice packet=ready-for-operator-decision contract=blocked dispatch=no executor=no reasons=operator-decision-missing authorization=none
```

Leia isso como: os fatos locais estão verdes, a fatia pode ser preparada, há decision packet suficiente para decisão do operador, mas o contrato segue bloqueado porque a confirmação explícita do operador não está presente. `dispatch=no` e `executor=no` continuam sendo fronteiras duras.

Caminho fail-closed por validação desconhecida:

```text
context-watch-one-slice-operator-packet: readiness=no preview=blocked packet=blocked contract=blocked dispatch=no executor=no reasons=packet-not-ready|operator-decision-missing|validation-gate-missing authorization=none
```

Esse caso prova que o pacote não inventa validação; foco sem gate conhecido volta para diagnóstico.

Caminho com validação conhecida mas sem arquivos declarados:

```text
context-watch-one-slice-operator-packet: readiness=yes preview=prepare-one-slice packet=ready-for-operator-decision contract=blocked dispatch=no executor=no reasons=operator-decision-missing|declared-files-missing authorization=none
```

Esse caso prova que foco único não equivale a escopo reversível. `task.files` ou evidência equivalente precisa existir antes de qualquer execução futura.

O operator packet reduz fricção em runs longas porque coloca a evidência em uma linha, mas não substitui autorização. Ele não cobre repetition, scheduler, self-reload, remote/offload, GitHub Actions, protected scopes ou manutenção destrutiva.

### Gate de backlog para executor one-slice

Implementar um executor one-slice só entra na fila quando todos os critérios abaixo estiverem verdadeiros:

1. estratégia de `.project` resolvida para a lane atual: hard intent local ou soft evidence/cache com ownership claro;
2. `context_watch_local_slice_operator_packet_preview` live-validado em caminhos verde, fail-closed e missing-files;
3. contrato explícito do operador definido por tarefa e ação, não confirmação genérica;
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

Para manutenção git, a regra é conservadora: diagnosticar, registrar e recomendar são permitidos; executar `git gc`, executar `git prune` ou remover `.git/gc.log` exige autorização explícita. Um aviso de manutenção não deve ser ignorado, mas também não deve virar limpeza destrutiva automática. Referência rápida operacional: `docs/guides/host-disk-recovery.md#manutenção-do-repositório-git` + tool read-only `git_maintenance_status`.

Para limpeza operacional simples (ex.: arquivos temporários de status/listagem), prefira uma remoção agrupada em um único comando bounded em vez de várias remoções unitárias. Isso reduz ruído de confirmação sem promover limpeza destrutiva ampla.

Para inspeção de dirty state, prefira snapshot sem arquivo temporário (`pnpm run git:dirty:snapshot`, command `/git-dirty`, ou tool read-only `git_dirty_snapshot`) em vez de `git diff --name-only > arquivo` seguido de `rm`. Fora de repositório git, a tool deve falhar fechado com envelope `unavailable` (sem erro cru).

Essa escada é parte da autonomia cultivada: reduzir hesitação e ruído, não aumentar gordura operacional. A resposta certa para um sinal pequeno deve ser curta e auditável; a resposta certa para um sinal estrutural deve virar tarefa estreita, não frente difusa.

### Triagem de capacidade (limpar vs pesquisar vs escalar)

Quando a lane travar, aplicar ordem curta e bounded:
1. **limpar leve/diagnosticar**: checar sinais locais (`machine_maintenance_status`, `git_maintenance_status`) e remover apenas ruído operacional pequeno;
2. **pesquisar**: só se existir gap técnico real que bloqueie a próxima fatia local-safe;
3. **escalar capacidade** (spawn/delegação/colony): só quando houver tarefa elegível e foco válido.

Regras de custo:
- evitar scans pesados por default (ex.: `du`/`find`/`ls -R` amplos sem limite/escopo);
- preferir diagnóstico read-only e comandos bounded;
- manutenção destrutiva de git continua opt-in com decisão explícita do operador.
- quando possível, deixar o bash guard bloquear padrões amplos e refazer com escopo + depth/timeout explícitos.

Paridade local↔CI (anti-drift):
- manter um comando canônico único para o gate principal (`pnpm run ci:smoke:gate`);
- CI deve chamar o mesmo comando (single source of truth), evitando drift entre pipeline e rotina local.

### Encerramento de turno: mini-packet condicional (quando houver material novo)

No fechamento de turno, use mini-packet **conciso** com 3 blocos:
1. status curto do que foi concluído/aberto;
2. próximos passos imediatos;
3. preview de decisão disponível no estado atual.

Quando aplicar (gatilhos):
- houve alteração relevante (código/docs/board/checkpoint);
- existe bloqueio, decisão pendente ou mudança de direção;
- o operador pediu explicitamente próximos passos/preview.

Quando **não** aplicar (evitar repetição):
- interação simples (ack, confirmação rápida, resposta pontual);
- não há material novo desde o último fechamento;
- já houve mini-packet recente e o estado permanece igual.

Regra de neutralidade:
- `preview` pode ser neutro;
- steering prescritivo (`faça X agora`, `promote|defer` recomendado) só entra quando houver pedido explícito do operador ou bloqueio real.

Escalonamento de governança:
1. **soft**: lembrar e corrigir no próximo fechamento aplicável quando faltar o mini-packet;
2. **hard**: se houver recorrência (operador precisando lembrar repetidamente), tratar ausência do mini-packet em fechamento aplicável como falha de contrato e corrigir imediatamente no próprio turno.

Objetivo: eliminar lembretes manuais sem inflar ruído operacional.

Template mínimo recomendado (copiar/colar):
- **Status:** <feito + aberto em 1-2 linhas>
- **Próximos passos:** <até 3 itens imediatos>
- **Preview de decisão:** <opções disponíveis agora, neutras quando possível>

Para reduzir perda de contexto entre compact/pause, o `autonomy_lane_status` deve expor `iterationReminder` curto (até 2 itens) com base em `handoff.next_actions` (fallback `none`). Quando houver `seedingGuidance.decision=seed-now`, o reminder deve priorizar instrução de seeding com `seedWhy` + `seedPriority`. Em handoff fresh, instruções de `/reload` já cumpridas devem ser suprimidas do reminder para evitar nudge stale. Quando o handoff estiver stale, o reminder deve priorizar `refresh-handoff` antes de sugerir continuidade. Em `no-eligible-tasks`, o `operatorPauseBrief` deve carregar `seedingCue` (`seedCount/seedWhy/seedPriority`) para decisão rápida; com handoff stale, a recomendação segue `refresh-handoff` antes de `seed-local-safe`. Esse lembrete é report-only e não altera autorização.

No fechamento operacional, ler também `reloadGate` e `timeoutPressureSummary` do `context_watch_status`: `reloadGate` mostra se `/reload` é pré-condição local naquele momento; `timeoutPressureSummary` fica em `none` quando estável, ou `count/threshold@window` sob instabilidade intermitente. São sinais de contexto rápido, não autorização.

### Fronteira pragmática: `lane-queue` vs `steering`/`follow-up` nativos (decisão 2026-05)

Decisão atual: **manter `lane-queue` com contrato mínimo**, sem promover para primitiva geral de direção.

Mapa operacional:
- **`follow-up` nativo / steering nativo**: caminho padrão para ação imediata no mesmo turno.
- **`lane-queue`**: backlog deferred entre turns (`add/pop`) e continuidade board-first (`board-next/evidence`) quando long-run está ativo.
- **`list/clear/pause/resume`**: controles operacionais da fila/loop (não substituem steering de produto).

Migração segura (sem quebra de continuidade local-safe):
1. se a intenção é executar **agora**, preferir `follow-up` nativo (ou override `lane-now:`);
2. se a intenção deve esperar o fim da fatia ativa, usar `lane-queue add`;
3. para continuidade orientada a board, usar `lane-queue board-next` (com milestone explícito quando necessário).

Regra anti-confusão: evitar usar `lane-queue` para micro-direção conversacional; usar apenas quando houver necessidade explícita de fila/deferimento.

Quando a lane local retornar `no-eligible-tasks`, não forçar continuidade no foco antigo. Faça checkpoint curto, rode intake/brainstorm/seed-preview report-only para escolher uma nova fatia local-safe explícita e só então retome a partir desse foco.

## Lane de delegação (wave 2026-05)

A evolução “delegar mais e executar menos” segue wave local-safe explícita, sem pular para automação protegida. O charter ativo da wave fica em `docs/research/control-plane-delegation-wave-2026-05.md` e define objetivos, métricas, limites hard e sequência de primitivas (`TASK-BUD-544..549`).

Contrato desta lane:
- primeiro consolidar snapshot/score/packet read-only com recommendationCode estável;
- depois formalizar runbook e checklist operacional por estágio;
- só discutir promoção de estágio com evidência verde e decisão explícita do operador para qualquer escopo protected.

Runbook por estágio (delegar mais, executar menos):

1. **Estágio local-safe (base)**
   - usar `delegation_lane_capability_snapshot` + `delegation_mix_score`;
   - se `decision=needs-evidence`, manter `local-execute` com fatia curta;
   - registrar verificação focal + commit pequeno.

2. **Estágio simple-delegate (bounded)**
   - usar `delegate_or_execute_decision_packet` + `delegation_readiness_status_packet`;
   - só aceitar recomendação `simple-delegate` quando status unificado estiver `decision=ready-simple-delegate` e sem blockers;
   - continuar sem auto-dispatch (decisão explícita do operador permanece obrigatória).

3. **Estágio swarm rehearsal (pré-protected)**
   - só abrir discussão após evidência repetida de estágio 2 estável;
   - manter checklist de rollback, validação focal e checkpoint fresco;
   - qualquer sinal de risco/protected volta para estágio anterior.

Checklist de evidência por estágio:
- snapshot/score/packet com `recommendationCode` explícito;
- verificação focal verde (smoke/marker/check);
- board + handoff atualizados com foco único;
- decisão de avanço/defer registrada em nota curta.

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

Nota operacional: `/reload` pode ser seguido imediatamente por auto-compactação/context-watch quando a sessão já está em janela de `checkpoint`/`compact` e há handoff/checkpoint suficiente. Isso é aceitável e deve ser comunicado como “pode acontecer”, não como bug. A forma segura de retomar é ler o handoff e continuar do foco registrado; se o contexto estiver baixo, a mesma ação de reload pode não disparar compactação.

Use o mesmo formato para outros bloqueios simples de continuidade: **ação necessária**, motivo em uma linha e próximos passos diretos. O objetivo é reduzir ambiguidade no fim do turno, não criar mais cerimônia.

## Falhas recorrentes

Quando o mesmo problema operacional se repetir, use `recurring_failure_hardening_plan` antes de escrever mais um lembrete. A regra é: primeira ocorrência pode virar regra curta; segunda ocorrência deve virar hard intent com primitiva e teste; depois disso, adicionar guard runtime ou bloquear o caminho antigo se ele continuar disponível.

O objetivo é evitar soft guidance repetida: se o agente continua esbarrando no mesmo problema, a stack deve tornar o caminho seguro mais fácil ou o caminho antigo menos disponível.

## Lane ativa de desacoplamento (maio/2026)

Para manter self-improvement contínuo com pouca intervenção do operador, usar a lane em:

- `docs/research/control-plane-decoupling-lane-2026-05.md`

Contrato dessa lane:
- progressão em três fases (`stabilize -> delegate -> decouple`);
- avanço só com KPI + gate explícito;
- rollback imediato quando houver violação de governança/foco.

Relatório operacional da lane (report-only):

```bash
pnpm run decoupling:maturity
pnpm run decoupling:maturity:json
```

Quando o estado vier como `colony-blocked-by-executor-propagation-gap`, o output passa a recomendar explicitamente a rota local-safe:
`colony_plan_packet` (modo `report-only`, sem `ant_colony`) para decompor o objetivo em 2-5 worker packets.

Lane serial validada para subagents locais:

1. `colony_plan_packet` cria plano report-only com 2-5 workers e `joinPolicy.mode=fail-closed`.
2. `colony_worker_start_packet` prepara exatamente um worker como `agentInvocationSpecPacket`; ainda não despacha e exige aprovação explícita do operador.
3. Após aprovação, executar só um `agent_run` serial, validar com `agent_run_outcome_packet` e salvar o artifact em `.project/reports/`.
4. Repetir o passo anterior para o próximo worker apenas depois de outcome PASS do worker atual.
5. `colony_serial_fanin_packet` agrega os outcomes sem dispatch, diferenciando `declaredFiles` read-only de `expectedArtifact` permitido como evidência. `cacheStatus=unknown` pode ser interpretado como `not-applicable` quando há outcome explícito, artifact presente/não vazio e output não vazio.

Critério de promoção da lane serial: `colony_serial_fanin_packet.decision=pass`, `blockers=[]`, artifacts requeridos em `.project/reports/`, `declaredTouchedFiles=[]`, `unexpectedTouchedFiles=[]` e `batchOutcomePacket.workerSummaries[*].touchedFileCount=0`. Qualquer missing outcome, artifact vazio, touch em declared file, ant_colony launch ou blocker de worker mantém o fan-in em BLOCK/PARTIAL e exige revisão do operador.

Batch local-safe de 3–5 fatias:
- seguir preflight + stop contracts do runbook em `docs/research/control-plane-decoupling-lane-2026-05.md`;
- parar imediatamente em `protected|risk|reload-required|validation-failed-or-unknown|no-successor`;
- registrar checkpoint curto por fatia para continuidade sem ambiguidade.

## Critério de qualidade crescente

A qualidade está aumentando quando:

- o agente interrompe menos por hesitação;
- o handoff fica mais curto e mais útil;
- decisões repetidas viram doutrina ou teste;
- ferramentas novas substituem ambiguidade, não adicionam ruído;
- refactors reduzem acoplamento sem abrir grandes frentes;
- inspirações externas viram princípios aplicáveis, não backlog difuso;
- remote canaries permanecem opt-in e auditáveis.
