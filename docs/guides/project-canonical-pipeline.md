# Pipeline canônico de posteridade (.project-first)

Objetivo: preservar contexto de forma durável e retomável com baixo custo.

Skill distribuída: práticas recorrentes deste guia são resumidas em `packages/lab-skills/skills/control-plane-ops/SKILL.md` para que o contrato board-first/long-run viaje com a stack, não apenas com a documentação local.

## Regra principal
1. **Canônico primeiro:** atualizar `.project/*`.
2. **Derivados depois:** `HANDOFF.md` (delta curto) e `ROADMAP.md` (macro).

## Diretriz de arquitetura (primitivas + adapters)
- O board `.project/*` é o **adapter canônico local atual** (fonte oficial de trabalho no workspace).
- A coordenação deve permanecer **backend-agnostic**: sistema de ticket/projeto é detalhe de implementação.
- A evolução first-party futura não substitui essa regra; ela entra como mais um adapter.
- Fluxos baseados em **Markdown/Obsidian** (ex.: inbox/caixa de notas) devem ser suportados via adapter, preservando os mesmos invariantes de governança (`no-auto-close`, evidência, revisão humana).
- Skills/processos/extensões com **hard intent** devem consumir o contrato de primitivas (task/event/intent/evidence), não um backend específico.
- Referência formal do contrato + matriz de adapters: `docs/primitives/continuity-abstraction.md`.

### Matriz operacional mínima de equivalência
- `.project` (canônico local atual): fonte oficial de status/verificação/handoff.
- First-party backend futuro: mesmo contrato canônico, novo adapter.
- Git trackers (GitHub/Gitea): projeção/sync de task-event-evidence sem alterar governança.
- Markdown/Obsidian: adapter de captura/espelho humano com frontmatter + journal estruturado.

### Camada de hard intent (independente de storage)
- `intent` resolve execução (ex.: board-first) sem acoplamento ao backend.
- `event + evidence` registram progresso e validação de forma auditável.
- `decisionGate` mantém `no-auto-close` e revisão humana para fechamento estratégico.

## Onboarding dual-mode (sem migração forçada)
Use este framing com usuários novos:

1. **Modo A — `.project-first` (canônico local)**
   - melhor quando o usuário quer governança integrada no workspace;
   - estado oficial em `.project/*`.

2. **Modo B — adapter-first (sistema do usuário)**
   - melhor quando o usuário já opera em outro sistema (Markdown/Obsidian, DB/API, automação/web);
   - o agente trabalha **junto** do sistema existente, sem impor migração total.

3. **Modo C — canônico + espelho humano (opcional)**
   - o estado oficial continua em `.project/*`;
   - um adapter projeta esse estado para Markdown renderizável (ex.: Obsidian/vault);
   - referência inicial de template: `https://github.com/aretw0/vault-seed`.

Invariantes em ambos os modos:
- `no-auto-close` para itens estratégicos;
- verificação auditável (`verification`) antes de `completed`;
- decisões/handoff curtos para retomada determinística.

### Modo de entrega multi-ambiente (native/container/CI)

Para calibrar execução contínua entre máquina local, container e CI:

- usar `/delivery-mode` (ou tool `delivery_mode_plan`) para obter plano determinístico de runtime (`native|container|ci`) e canal de promoção (`direct-branch|pull-request|merge-request`);
- sinais de CI nativos (`GITHUB_ACTIONS`, `GITLAB_CI`, `GITHUB_EVENT_NAME`, `CI_MERGE_REQUEST_IID`) têm precedência alta;
- override explícito opcional: `PI_DELIVERY_CHANNEL=direct|pr|mr`;
- quando houver paralelismo entre ambientes, manter escrita lock-aware+atômica para `.pi/settings.json` e `.project/handoff.json` (evita corrupção parcial/conflito de merge por arquivo truncado).

#### GitHub Actions (modo fábrica guardado)

- em `pull_request*`, tratar canal padrão como `pull-request` (promoção revisável);
- em `push` para branch protegida, permitir `direct-branch` somente quando gates de governança/qualidade estiverem verdes;
- logar no job um advisory curto (`runtime=ci provider=github-actions channel=...`) para trilha operacional;
- fallback determinístico quando gate falhar: executar local/container com `/delivery-mode`, corrigir, e promover por PR revisado.

### Budget de reinflação do orchestrator (`guardrails-core.ts`)

Para manter a stack pronta para jornadas rasas e profundas sem acoplamento opinativo:

- tratar `guardrails-core.ts` como **orquestrador de wiring**; lógica nova deve nascer em primitiva/surface dedicada (`guardrails-core-*.ts`);
- quando uma mudança adicionar bloco grande no core (ordem de dezenas de linhas), priorizar extração no mesmo ciclo ou no slice imediatamente seguinte;
- commands/tools novos devem registrar via módulo de superfície (`registerGuardrails*Surface`) para reduzir drift e facilitar adoção parcial pelos usuários;
- manter smoke focal de contrato/superfície ao extrair, garantindo que API pública permaneça estável;
- manter guard executável de budget (`guardrails-core-orchestrator-budget.test.ts`) e apertar o teto em ratchet progressivo (estado atual: `<=3600` linhas no orchestrator).

### Hatch progressivo (simple-first)

Para primeiro contato de sessão/projeto, o hatch deve começar em trilha simples:
- `/colony-pilot hatch check` => modo `simple` por padrão (sem CTA direta de swarm/delegação);
- trilha inicial focada em diagnóstico/recuperação (`/status`, `/doctor`, `/colony-pilot check`, `/quota-visibility budget 30`);
- escala avançada só por opt-in explícito (`/colony-pilot hatch check --advanced`).

### Checklist de release/dogfooding (portabilidade da fábrica)

Antes de promover hardening interno como capability da pi-stack:
1. **Separar canônico vs local:** confirmar que a melhoria está em primitivas/adapters (não em convenção exclusiva do laboratório).
2. **Native-first por padrão:** quando existir primitiva first-party (ex.: steer/follow-up), ela deve ser default; convenções extras ficam opt-in.
3. **Governança preservada:** manter `no-auto-close`, `verification gate` e budget discipline em qualquer interface/runner.
4. **Evidência de portabilidade:** registrar no board ao menos 1 verificação (`inspect`/`command`/`test`) provando que o ganho é reutilizável fora do agents-lab.
5. **Rollback explícito:** documentar fallback seguro caso a promoção aumente ruído, custo ou acoplamento.

## Loop operacional (5-10 min)
1. Capturar mudanças no board canônico:
   - `decisions`, `requirements`, `tasks`, `verification`, `handoff`.
2. Rodar higiene:
   - `npm run project:verification:check`
   - `npm run pi:artifact:audit` (ou `:strict` no gate)
   - `project-validate`
   - `project-status`
3. Atualizar derivados:
   - `HANDOFF.md` com **apenas delta operacional**.
   - `ROADMAP.md` com direção macro (sem estado diário).
4. Fechar sessão com WIP=1:
   - manter uma frente ativa em `in-progress` por sessão.

## Template rápido (copiar/colar)

### 1) Decisão (decisions)
- **id:** `DEC-<domínio>-<nnn>`
- **title:** decisão em 1 linha
- **status:** `decided`
- **context:** problema/risco
- **decision:** escolha feita
- **consequences:** trade-offs e impacto

### 2) Requisito (requirements)
- **id:** `REQ-<domínio>-<nnn>`
- **title:** regra/capacidade obrigatória
- **priority:** `must|should`
- **status:** `accepted|proposed`
- **acceptance_criteria:** lista objetiva

### 3) Task (tasks)
- **id:** `TASK-<domínio>-<nnn>`
- **description:** objetivo curto
- **status:** `planned|in-progress|completed|blocked`
- **files:** superfícies tocadas
- **acceptance_criteria:** 2-4 critérios testáveis
- **notes:** evidência e contexto resumidos

### 4) Verificação (verification)
- **id:** `VER-<domínio>-<nnn>`
- **target:** `TASK-...`
- **target_type:** `task`
- **status:** `passed|partial|failed`
- **method:** `command|inspect|test` (agnóstico de stack)
- **evidence:** evidência curta e auditável
- **timestamp:** ISO

## Soft intent vs Hard gate de qualidade
- **Soft intent (advisory):** monitor orienta verificar em granularidade de slice; não bloqueia sozinho.
- **Hard gate (canônico):** promoção/conclusão estratégica requer `verification` com `status=passed` vinculada ao target.
- Use `inspect` para governança/doc/processo e `command/test` quando houver impacto executável.
- Referência de contrato: `docs/primitives/quality-verification-gate.md`.

### Monitores por modo de execução

Long-runs precisam de monitores como trilho de confiança, não como fricção de permissão repetida. Política resumida:

- `interactive-dev`: feedback rico; L1/L2/L3 podem aparecer imediatamente.
- `control-plane`: L1/L2 com cooldown e sem bloquear `warn`; L3 só para risco real/autorização/custo/dados.
- `overnight/unattended`: no-interrupt por default; advisory agregado em checkpoint/erro repetido; hard gates preservados.
- `subagent`: mínimo local; retorno agregado para o control-plane decidir.
- `swarm/colony`: governança em budget/delivery/selective-promotion; reviewer/soldier substitui nudges por-turno.

Lease válido de long-run = loop running + task/intenção elegível + budget/provider/machine seguros + escopo autorizado. Enquanto o lease valer, monitores não devem pedir confirmação redundante; devem auditar ou agregar sinal. Runbook completo: `docs/guides/monitor-overrides.md#política-por-modo-de-execução`.

### Soft/hard intent de internacionalização
- **Comunicação:** `piStack.guardrailsCore.i18nIntents.communication` é soft intent; orienta a língua da resposta ao usuário (`auto-user-profile` por default), mas pode ceder a instrução explícita do turno/sistema.
- **Artefatos:** `piStack.guardrailsCore.i18nIntents.artifacts` é hard intent; arquivos persistidos devem preservar a língua existente ou seguir a política configurada, sem traduzir comandos, paths, APIs, IDs ou evidências citadas por acidente.
- **Overrides:** `artifacts.rules[]` permite regras por `pathPrefix` e `extensions`, incluindo `generateTranslations=true` e `translationTargets[]` para traduções opt-in de escopos selecionados.
- **Auditoria:** quando a política estiver ativa, `guardrails-core` registra `guardrails-core.i18n-intent-policy`; verificações de docs devem registrar idioma pretendido, preservação/override e qualquer tradução opt-in.
- Runbook completo: `docs/guides/i18n-intents.md`.

## Política no-obvious-questions no loop canônico

Para manter velocidade de cruzeiro em long-run:
- ambiguidades de baixo risco devem ser resolvidas por default seguro/determinístico;
- interrupção do usuário apenas em risco irreversível/perda de dados/conflito de objetivo;
- assunções automáticas devem ficar auditáveis no runtime (`guardrails-core.pragmatic-assumption-applied`) e refletidas no board quando impactarem decisão de tarefa.

### Perfil opt-in de economia de contexto

O baseline permanece agnóstico e simples: board canônico, handoff curto, gates locais e monitores calibrados. Otimizações inspiradas em `squeez` devem entrar como perfil **opt-in** de economia de contexto, com os seguintes limites:

- **Baseline:** dedupe de intents, auditoria throttled, `context-watch` como steering e handoff resumido.
- **Opt-in:** output shaping mais agressivo, dedupe semântico de status repetitivo, sumarização compacta de tool-output e checkpoints sintéticos quando o contexto estiver perto do threshold.
- **Não-goal:** acoplar a stack a hooks de um CLI específico ou esconder evidência canônica necessária para retomada.
- **Métrica mínima:** menor tamanho de handoff/tool-output por slice e menor custo/contexto, sem novos classify failures, sem perda de verificação e sem impacto perceptível no smoke focal.

Sinais de oportunidade de economia devem ser **passivos e pouco ruidosos**: status/telemetria curta que indique repetição de tool-output, handoff grande demais, evidência re-lida após compactação ou lista de next-actions truncada. O sinal deve sugerir "economizar no próximo slice" sem forçar compactação nem esconder evidência canônica. Influências como `squeez` entram assim no dia a dia: output shaping, dedupe e checkpoints sintéticos como prática incremental, sempre medidos contra retomada correta.

A adoção eventual de `mdt` fica separada: é trilha de **doc-drift/single-source docs** (`check` primeiro, `update` depois), não pipeline de ideias/backlog.

### Storage pressure antes de long-run

Long-runs maiores só são confiáveis quando o ambiente ainda tem folga de armazenamento. Antes de lote grande, ou quando o host estiver perto do limite, usar o gate dry-first:

```bash
npm run ops:disk:check
# equivalente: node scripts/host-disk-guard.mjs
```

Contrato atual:
- `host-disk-guard` é **dry-run por default** e não remove sessões sem opt-in explícito;
- saída inclui `disk: severity=ok|warn|block-long-run|unknown`, espaço livre, uso percentual e recomendação acionável;
- saída inclui inventário volátil bounded: `bgArtifacts`, `reports`, `sessions` (sandbox) e `globalSessions` (namespace global do workspace), além de resumo de candidatos por classe (`byClass`) para priorização segura;
- saída também inclui projeção `projectedAfterApply` (severidade/espaço livre estimado após aplicar o plano atual) para decisão dry-first sem execução cega;
- se `severity=block-long-run`, pausar lotes grandes/benchmarks/e2e/browser e fazer cleanup dry-run + confirmação humana antes de continuar;
- para gate determinístico em automações, usar `npm run ops:disk:strict` (exit 1 quando `severity=block-long-run`) ou `npm run ops:disk:strict:warn` para modo conservador (warn+block).
- logs `/tmp/oh-pi-bg-*` são candidatos seguros de temp artifact, mas sessões JSONL são evidência e permanecem protegidas salvo `--include-sessions` explícito;
- para dry-run focado apenas em temporários seguros, usar `npm run ops:disk:cleanup:bg:dry` (equivale a `--classes=bg-artifact`);
- para diagnóstico dry-run por classe, usar também `npm run ops:disk:cleanup:reports:dry`, `npm run ops:disk:cleanup:sessions:dry` (sandbox) e `npm run ops:disk:cleanup:global-sessions:dry` (namespace global); para revisão mais agressiva sem apply, usar `ops:disk:cleanup:global-sessions:review` (age=7d, keepRecent=4). Sessões ficam em preview explícito antes de qualquer apply.

Evitar diagnósticos ad-hoc amplos (`du`/`grep`/`find` sobre C:, home, `node_modules`, AppData) durante long-run: preferir `host-disk-guard` e comandos focais com limite de saída.

### Discoverability operacional da lane-queue

Política operacional atual: **native-first**.

Durante long-run:
- priorizar steer/follow-up nativo (`Alt+Enter` / `app.message.followUp`) para continuidade de turno;
- usar `lane-queue` apenas como trilha **opt-in** para deferimento cross-turn em janela idle;
- quando `lane-queue` for usada, `/lane-queue` (status) deve orientar ações concretas com `queued>0` (`list`/`clear`) e `/lane-queue help` deve manter discoverability imediata;
- para board-first unattended, usar `/lane-queue board-next`: seleciona deterministicamente a próxima task elegível (`planned + deps satisfeitas + prioridade [P0..Pn] + id`) e injeta intent canônico com contrato `no-auto-close + verification` (quando a lane já está ocupada, enfileira `board.execute-next` para reavaliar o next no momento do dispatch).
- para fechamento estratégico/no-auto-close, gerar primeiro um pacote compacto via `board_decision_packet`: opções `close | keep-open | defer`, evidências recentes de verification, blockers e riscos; a decisão humana continua explícita e o pacote não altera status sozinho.
- opcionalmente, usar escopo por milestone user-defined: `/lane-queue board-next --milestone "<label>"` (ou `-m "<label>"` / `-m=<label>`) para restringir seleção ao recorte atual sem fixar semântica de release no core.
- para diagnóstico sem dispatch, `/lane-queue status` aceita o mesmo override (`--milestone|--milestone=|-m|-m=|--no-milestone`) e expõe `statusMilestone=<label|n/a>@<source>` (`explicit|default|cleared|none`).
- `/lane-queue evidence` também aceita override de milestone com o mesmo contrato e inclui `boardReadiness` scoped + `boardHint` quando não há elegível no recorte informado, além de `scopeParity` (expected/boardAuto/loopReady + `reason=match|mismatch|no-expectation`) para diagnóstico rápido de consistência de escopo; notify deve subir para `warning` quando `readyForLoopEvidence=no` (alias legado: `readyForTaskBud125`) ou `scopeParity.matches=no`.
- para unattended contínuo focado em milestone, pode-se definir `piStack.guardrailsCore.longRunIntentQueue.defaultBoardMilestone` em `.pi/settings.json`; quando presente, status/auto-advance/board-next sem flag herdam esse escopo por default.
- operação via comando: `/guardrails-config set longRunIntentQueue.defaultBoardMilestone "MS-LOCAL"` (limpeza: `unset|none|null`).
- quando for necessário ignorar o default em uma execução pontual, usar `/lane-queue board-next --no-milestone` (ou `/lane-queue status --no-milestone` para apenas validar readiness sem disparo).
- auto-advance só deve ocorrer em condição segura (`lane idle` + `queue empty` + `loop running/healthy` + `stopCondition=none` + board ready com `nextTaskId`), com dedupe de task e auditoria explícita.
- para observação operacional, `/lane-queue status` deve expor `runtimeCode=<active|reload-required|unknown>`, `boardAutoGate=<reason>`, `boardAutoLast=<task@age|n/a>`, `evidenceBoardAuto=<task[milestone?]@age runtime emLoop|n/a>`, `evidenceLoopReady=<age milestone? runtime gate|n/a>` e marcadores `READY/ACTIVE_HERE/IN_LOOP` para diagnosticar por que o auto-advance não disparou (incluindo `dedupe-window` quando a mesma task foi disparada há pouco).
- filas de intents canônicos (`board.execute-task`) devem aplicar dedupe por janela (`rapidRedispatchWindowMs`) para reduzir re-enqueue redundante após falha silenciosa em sessão compactada.
- quando `boardAutoGate != ready`, registrar auditoria throttled (`guardrails-core.board-intent-auto-advance-deferred`) com razão e contexto mínimo para evidência de runtime sem spam.
- eventos de auto-advance (`...auto-advance`, `...auto-advance-deferred`, `...auto-advance-failed`) devem carregar `runtimeCodeState` para comprovar se o comportamento observado já está com código ativo (`active`) ou ainda depende de reload (`reload-required`).
- o runtime deve emitir `guardrails-core.loop-activation-state` (throttled por mudança de label) para registrar transições dos marcadores `READY/ACTIVE_HERE/IN_LOOP` sem depender de comando manual.
- quando houver transição para `IN_LOOP=yes`, emitir `guardrails-core.loop-activation-ready` uma vez por transição para facilitar detecção de “loop liberado” em tempo real.
- quando `IN_LOOP=no`, expor `loopHint` alinhado ao `blocker` (reload/queue/gate/loop-state) para correção rápida sem investigação ampla.
- compatibilidade retroativa: snapshots/evidências antigas podem conter `PREPARADO/ATIVO_AQUI/EM_LOOP`; tratar `markersLabel` como texto histórico e usar campos estruturados (`runtimeCodeState`, `emLoop`, `boardAutoAdvanceGate`) como contrato canônico de decisão.
- `/lane-queue status` deve exibir `loopReadyLast` e `loopReadyLabel` para evidenciar a última transição de loop liberado dentro da sessão atual.
- `/lane-queue evidence` deve mostrar o snapshot persistido mais recente (`boardAuto`/`loopReady`) para comprovação rápida sem varredura de JSONL, incluindo `readyForLoopEvidence=yes|no` (com alias legado temporário `readyForTaskBud125`) e critérios explícitos (`runtime active` + `emLoop=yes`).
- para gate operacional fora do TUI, usar `npm run ops:loop-evidence:check` (humano) e `npm run ops:loop-evidence:strict` (CI/rollback gate) sobre `.pi/guardrails-loop-evidence.json` com janela de frescor explícita; quando operar por milestone, pode-se exigir paridade de escopo via `node scripts/guardrails-loop-evidence-check.mjs --strict --expect-milestone "<label>"` ou usar `npm run ops:loop-evidence:strict:default-milestone` para validar contra `defaultBoardMilestone` configurada; a saída expõe `milestoneGate=active|inactive`, `milestoneCheck`, `strictFailures` e `strictHint(<code>)` para ação direta (`evidence-stale`, `readiness-not-ready`, `milestone-mismatch`, etc.) sem leitura manual do JSON. Para transformar a ideia de milestone em hard gate explícito, adicionar `--require-milestone-gate` ao strict check (falha com `milestone-gate-inactive` quando nenhum `--expect-milestone`/`@default` está ativo). Atalhos: `npm run ops:loop-evidence:strict:milestone-gate` para exigir qualquer gate ativo; `npm run ops:loop-evidence:strict:default-milestone` para exigir o `defaultBoardMilestone` configurado.
- intents canônicos devem usar envelope tipado (`[intent:<type>]` + campos `key=value`, ex.: `board.execute-task` e `board.execute-next`; opcional `milestone=<label>` em `board.execute-next`) para reduzir fragilidade de dispatch textual e manter auditabilidade entre extensões.
- runtime deve consumir envelope no caminho de execução (input) além do prompt: envelope inválido/unsupported é rejeitado com audit explícita; envelope válido registra decisão (`ready`/`board-not-ready`/`next-mismatch`/`next-ready`) antes da execução.

### Retry resiliente para overload/rate-limit de provider

Para preservar continuidade em long-run diante de erros transitórios (`server_is_overload`, `429`, `5xx`):

- classificar falhas transitórias de provider explicitamente (não tratar tudo como falha fatal);
- aplicar retry com backoff progressivo e cap de delay;
- manter `maxAttempts` operacional **>= 10** antes de bloquear por streak;
- manter auditoria curta com classe de erro + delay aplicado por tentativa.

Configuração (`.pi/settings.json`):

```json
{
  "piStack": {
    "guardrailsCore": {
      "longRunIntentQueue": {
        "dispatchFailureBlockAfter": 3,
        "rapidRedispatchWindowMs": 300000,
        "dedupeWindowMs": 120000,
        "identicalFailurePauseAfter": 3,
        "orphanFailurePauseAfter": 1,
        "identicalFailureWindowMs": 120000,
        "orphanFailureWindowMs": 120000,
        "providerTransientRetry": {
          "enabled": true,
          "maxAttempts": 10,
          "baseDelayMs": 2000,
          "maxDelayMs": 60000,
          "backoffMultiplier": 2
        }
      }
    }
  }
}
```

Notas operacionais:
- para erro transitório, o threshold efetivo de block vira `max(dispatchFailureBlockAfter, maxAttempts)`;
- para erro não transitório, mantém `dispatchFailureBlockAfter` normal;
- status da lane continua mostrando `failStreak=n/<threshold>`, `identicalFail=n/<pauseAfter>@<windowMs>`, `failClass=<provider-transient|tool-output-orphan|other|n/a>`, `failPolicy=<pauseAfter@windowMs|n/a>` e `failSig=<fingerprint>` para decisão rápida do operador;
- o `failSig` normaliza variantes de `call_id`/`tool_call_id` para mesma assinatura canônica (`call_id=call_*`), evitando falso reset de streak por ruído de formato do provider;
- quando o retry transitório esgotar, o status deve sinalizar `nextDrain=stopped:retry-exhausted` com 3 ações curtas: diagnosticar providers (`/provider-readiness-matrix`), opcionalmente trocar (`/handoff --execute ...`) e retomar (`/lane-queue resume`);
- quando `failClass=tool-output-orphan`, o loop aplica pausa no threshold configurado (`orphanFailurePauseAfter`, default=1) e usa janela de streak própria (`orphanFailureWindowMs`, default=120000); status sugere recuperação curta: `/reload` → `/lane-queue status` → `/lane-queue resume`.

### Configuração operacional sem editar JSON manualmente

Para ajustes frequentes de runtime (long-run queue + autonomia pragmática), preferir comando dedicado:

- `/guardrails-config status`
- `/guardrails-config get <key>`
- `/guardrails-config set <key> <value>`

Exemplos:
- `/guardrails-config get longRunIntentQueue.maxItems`
- `/guardrails-config set longRunIntentQueue.maxItems 80`
- `/guardrails-config set longRunIntentQueue.enabled true`
- `/guardrails-config set longRunIntentQueue.identicalFailurePauseAfter 3`
- `/guardrails-config set longRunIntentQueue.orphanFailurePauseAfter 1`
- `/guardrails-config set longRunIntentQueue.identicalFailureWindowMs 120000`
- `/guardrails-config set longRunIntentQueue.orphanFailureWindowMs 120000`
- `/guardrails-config set longRunIntentQueue.dedupeWindowMs 120000`
- `/guardrails-config set contextWatchdog.modelSteeringFromLevel checkpoint`
- `/guardrails-config set contextWatchdog.userNotifyFromLevel compact`
- `/guardrails-config set contextWatchdog.autoCompact false`

Contrato:
- `set` valida tipo/faixa antes de gravar em `.pi/settings.json`;
- cada mudança gera audit trail curto (`guardrails-core.runtime-config-set`);
- comando informa se reload é recomendado/necessário para consistência da sessão;
- fallback manual (`.pi/settings.json`) fica restrito a chaves não suportadas.

### Roteamento determinístico de shell por host (evitar tentativa-e-erro)

Para reduzir falhas de execução por mismatch de shell/PATH, o guardrails-core aplica perfil de host em runtime.

Contrato inicial (hard-pathway):
- em `Windows + Git Bash`, comandos node-family no tool `bash` (`node/npm/npx/pnpm/yarn/vitest`) devem usar `cmd.exe /c <comando>`;
- comando bare (ex.: `npm run test`) nessa combinação é bloqueado com instrução determinística de fallback;
- sessão registra perfil/ações em audit trail (`guardrails-core.shell-routing-profile`, `guardrails-core.shell-routing-block`) e status curto (`guardrails-core-shell`);
- operador pode inspecionar/normalizar via `/shell-route status` e `/shell-route wrap <command>`.

Objetivo: transformar um soft-intent operacional em comportamento previsível e reproduzível, sem depender de acerto manual do agente.

### Macro-APIs determinísticas (roadmap de refactor)

Para reduzir edição "na unha" em fluxos repetitivos, priorizar superfície macro com contrato estável:

- `refactor_rename_symbol`
- `refactor_organize_imports`
- `refactor_format_target`

Contrato mínimo:
- `dryRun=true` por default;
- resposta com preview + escopo de arquivos afetados;
- `apply` com trilha auditável e rollback mínimo.

Implementação incremental atual:
- helper first-party `guardrails-core-macro-refactor.ts` com builders determinísticos para `refactor_rename_symbol`, `refactor_organize_imports` e `refactor_format_target`;
- tools canônicas publicadas no guardrails-core com mesmo contrato (`refactor_rename_symbol`, `refactor_organize_imports`, `refactor_format_target`);
- comando operador `/macro-refactor` (`rename-symbol`, `organize-imports`, `format-target`) para preview/apply explícito;
- fallback explícito `engine-unavailable` quando LSP/formatter runtime não estiver disponível (sem apply silencioso);
- trilha auditável `guardrails-core.macro-refactor.*` para inspeção de decisão/risco;
- smoke de contrato/superfície: `guardrails-macro-refactor-contract.test.ts`, `guardrails-macro-refactor-tool.test.ts`, `guardrails-macro-refactor-command.test.ts`.

Referência de contrato inicial: `docs/research/task-bud-144-macro-api-contract-2026-04-24.md`.

### Mutação segura para arquivo grande e query estruturada (roadmap)

Para operações de maior risco (arquivo extenso / SQL), usar pathway dedicado com preflight explícito.

Contrato mínimo:
- `dryRun=true` por default;
- patch orientado a bloco/âncora (evitar substituição textual ampla);
- limite de blast-radius (`maxTouchedLines`) com bloqueio explícito;
- saída com `rollbackToken` + evidência (`preview`, limites aplicados, decisão).

Implementação incremental atual:
- helper first-party `packages/pi-stack/extensions/guardrails-core-safe-mutation.ts` com avaliação determinística de risco para mutação em arquivo grande/query (`assessLargeFileMutationRisk`, `assessStructuredQueryRisk`);
- builders canônicos de payload dry-first (`buildSafeLargeFileMutationResult`, `buildStructuredQueryPlanResult`);
- reexport em `guardrails-core.ts` para superfície unificada da stack;
- comando dry-first para operador: `/safe-mutation` (`help`, `large-file`, `query`) com audit trail (`guardrails-core.safe-mutation.*`) e validação explícita de contagem de linhas (`touchedLines/maxTouchedLines` inteiros em faixa);
- tools tipadas `safe_mutate_large_file` e `structured_query_plan` para consumo determinístico em workflows/subagentes, mantendo os mesmos guardrails de risco/forbidMutation e bloqueio explícito de query multi-statement/vazia;
- seed de I/O estruturado (loam-inspired): `guardrails-core-structured-io.ts` com `structuredJsonRead`/`structuredJsonWrite` e selector canônico (inclui bracket-quoted key, ex.: `a["b.c"]`);
- pathway unificado AST-first leve: `structuredRead`/`structuredWrite` resolvem `kind=auto|json|markdown|latex`; JSON usa parser nativo, Markdown usa seções por heading (`heading:<título>`) e LaTeX usa seções (`section:<título>`), sempre com `sourceSpan`, `via`, dry-run e cap de blast-radius;
- reexport de structured I/O em `guardrails-core.ts` para consumo unificado (`parseStructuredJsonSelector`, `structuredJsonRead`, `structuredJsonWrite`, `structuredRead`, `structuredWrite`, `resolveStructuredIoKind`);
- comando operador `/structured-io` (`json-read`, `json-write`) com dry-run default, cap de blast-radius, validação de `--max-lines` (inteiro positivo) e audit trail (`guardrails-core.structured-io.*`);
- seletores JSON aceitam índice em bracket (`a.b[0].c`) e seletor raiz (`$`) para replace de documento inteiro com `set`; `remove` na raiz é bloqueado explicitamente (`root-remove-unsupported`);
- tool tipada unificada `structured_io` (`read|set|remove`) cobre JSON/Markdown/LaTeX; tool legada `structured_io_json` permanece para compatibilidade, ambas dry-first por default;
- smokes de contrato/superfície: `guardrails-safe-mutation-contract.test.ts`, `guardrails-safe-mutation-reexport.test.ts`, `guardrails-safe-mutation-registration.test.ts`, `guardrails-structured-io-contract.test.ts`, `guardrails-structured-io-command.test.ts`, `guardrails-structured-io-reexport.test.ts`, `guardrails-structured-io-tool.test.ts`.

Referência de contrato inicial: `docs/research/task-bud-145-safe-mutation-structured-query-contract-2026-04-24.md`.
Evolução planejada para I/O estruturado centralizado (loam-inspired): `docs/research/task-bud-149-structured-io-loam-bridge-2026-04-25.md`.

### Steering signal-first (tool-surface diet)

No loop canônico, steering diário deve priorizar **sinais passivos de stream/status** (ex.: `warn/checkpoint/compact`, `operatorSignal`) em vez de depender de tool-call manual.

Regras operacionais:
- `context_watch_status` fica como superfície de **diagnóstico explícito** (debug/inspeção), não como passo obrigatório por iteração;
- no segundo `warn` consecutivo, a cadência deve escalar para checkpoint/handoff automático antes do compact;
- sinais de intervenção humana (`reload-required`, `handoff-refresh-required`) devem aparecer no stream para evitar surpresa de controle;
- delivery de `warn/checkpoint/compact` deve ser tratado como **invariante de steering passivo** (modo-independente), com fallback quando a superfície principal não estiver visível.

Implementação atual (slice 2/4):
- persistência de steering (`context_watch_events`/`next_actions`) independe de `notify`;
- status passivo (`context-watch-steering`) é atualizado continuamente por avaliação para evitar estado visual stale;
- `warn/checkpoint` permanecem em fallback de status/telemetria (sem notify textual) para evitar perturbação prematura antes da janela de compactação;
- `compact` é o único nível notificado por padrão (instrução clara de wrap-up + checkpoint + idle).
- semântica de config explícita: `modelSteeringFromLevel` controla quando o modelo começa a receber steering passivo e `userNotifyFromLevel` controla quando notificar o operador (ambas em `contextWatchdog`), evitando ambiguidade com `notify` legado.
- auditoria dedicada: `context-watchdog.passive-steering-signal`.

Referência de contrato inicial: `docs/research/task-bud-146-context-steering-signal-invariant-2026-04-24.md`.

Nota operacional (atalhos): o pacote `pi-workflows` registra `Ctrl+H` para solicitar pause de workflow. Em alguns terminais, `Ctrl+Backspace` envia `Ctrl+H`; isso pode disparar pause acidental com a mensagem “Pause requested — workflow will pause after current step completes.”.

### Bloat-smell advisory (calibrado, baixo ruído)

Objetivo: preservar throughput de fábrica sem inflar resposta/código em silêncio.

Regras operacionais:
- manter bloat-smell em modo **advisory passivo** por padrão (status/audit; sem hard-block);
- sinais de runtime esperados:
  - texto: `guardrails-core-bloat`
  - código: `guardrails-core-bloat-code`
  - slice amplo em arquivo único: `guardrails-core-slice-width` (advisory)
- manter `notifyOnTrigger=false` durante calibração inicial; promover para notify apenas após estabilidade de sinal/ruído;
- para scouts (`scout burst`), usar bloat-smell para mapear hotspots de split/síntese, mas registrar recomendação no board antes de escalar enforcement;
- quando disparar smell recorrente, converter em micro-slice explícito (split de tarefa/arquivo) em vez de tratar como ruído transitório.
- para `guardrails-core-slice-width`, ação padrão é: (1) quebrar em micro-slices no mesmo arquivo; (2) se indivisível no momento, registrar backlog/nota no board antes de seguir.

### Pipeline de galvanização (repetitivo -> hard pathway)

Objetivo: reduzir consumo recorrente de LLM sem perder governança.

Fluxo canônico:
1. **Descobrir** padrões repetitivos com evidência de consumo (`tokens/cost/requests`) via analytics (`session_analytics_query` tipo `galvanization`).
2. **Classificar e ranquear** oportunidade por frequência + gasto observado (determinístico, advisory).
3. **Propor pathway hard** por candidato com gates explícitos:
   - equivalência funcional em fixture representativo;
   - rollout em dry-run com rollback imediato;
   - `verification` passed antes de promover default.
4. **Roadmap de mitigação** registra baseline vs pós-automação projetado (`tokens/cost/requests`) para priorização, sem implementar hardening prematuro fora da lane ativa.

### Governança de sinais (ownership + noise-budget)

Objetivo: manter discoverability útil sem sobrecarregar o operador com sinais concorrentes.

Ownership mínimo por classe:
- **operator**: sinais de ação humana imediata (ex.: `reload-required`, `handoff-refresh-required`, `compact-checkpoint-required`).
- **runtime**: sinais técnicos de execução (ex.: bloat, budget, lane status).
- **governance**: sinais de gate/promoção canônica (verification, readiness, preflight).
- **discoverability**: dicas de uso (help/list/clear), sempre subordinadas ao contexto operacional ativo.

Regras de noise-budget (advisory):
- priorizar stream/status passivo; evitar notificação ativa para sinais de mesma classe na mesma janela curta;
- quando houver conflito, precedência: `operator` > `governance` > `runtime` > `discoverability`;
- limitar discoverability a momentos de intenção explícita (erro de comando, `queued>0`, primeira exposição de feature), sem repetição contínua.

Meta-sinal de ruído excessivo (advisory):
- detectar concentração de sinais de baixa prioridade em sequência curta e recomendar simplificação;
- ação padrão: reduzir superfície para status passivo + 1 recomendação consolidada;
- manter modo não-bloqueante por default para não travar throughput de fábrica.

### Governança de board em worktrees/sessões paralelas

Política padrão: **single writer canônico** para `.project/tasks.json` e `.project/verification.json`.
Worktrees/subagentes podem propor mudanças, mas a sessão control-plane principal aplica via `board_query`/`board_update` ou etapa gerada/revisada.

Quando houver mais de um writer potencial:
- usar `state_reconcile_plan` para classificar risco antes da mutação;
- exigir `lock-and-atomic-write` para escrita direta no board;
- preferir `single-writer-branch` + `generated-apply-step` para worktrees;
- registrar em evidência quais notas/status/verificações foram promovidos e quais ficaram fora de escopo;
- se houver conflito de notas/status, não sobrescrever silenciosamente: converter em item de reconciliação/manual review.

Fluxo pós-worktree recomendado:
1. worker entrega diff/patch ou resumo gerado, sem assumir posse do board canônico;
2. control-plane compara `mtime`/branch e aplica update canônico com lock+atomic;
3. valida `board_query`/verificação focal;
4. commit inclui board apenas se a promoção foi intencional.

### Mirror externo (GitHub/Gitea) sem perder board canônico

Entidades externas são **mirrors**, não autoridade principal, salvo política explícita por projeto.

Contrato de sync:
- task id local permanece canônico; issue URL/número entra em nota/evidência;
- labels/status externos são importados apenas por mapping explícito;
- fechamento externo não completa task local sem `verification` passada;
- sync deve ser idempotente: não duplicar nota de mesma URL/número e não rebaixar status local sem conflito auditado;
- direção default é `.project` -> externo; import externo vira proposta/nota quando divergir.

Contrato de conflito:
- se remoto e local discordam em status/labels/evidência, registrar nota curta com campos conflitantes;
- não usar `gh issue edit/close` ou mutações públicas sem intenção explícita do operador;
- preservar `no-auto-close` estratégico: fechamento é sempre local + verificação + commit auditável.

### Contrato de promoção seletiva (worktree -> main)

Quando o delivery mode estiver em `apply-to-branch`, a evidência de conclusão deve explicitar seleção de escopo:
- `Promoted file inventory`: arquivos efetivamente promovidos para o branch-alvo;
- `Skipped file inventory`: arquivos não promovidos + motivo (`out-of-scope`, `unsafe`, `no-evidence` etc).

Regras operacionais:
- `Final file inventory` continua obrigatório como visão global;
- ausência de `Promoted/Skipped file inventory` deve manter run em trilha de recovery/candidate (sem auto-close);
- validação (`Validation command log`) permanece obrigatória quando o gate de delivery exigir.

## Guardrail de scan-bounds no loop longo
Em sessões com `context_watch` em `warn`/`checkpoint`/`compact`:
1. **Warn:** somente investigação bounded-by-default (sem busca ampla em logs/sessions).
2. **Checkpoint:** handoff canônico obrigatório antes de novo diagnóstico.
3. **Compact:** parar investigação, compactar e retomar do handoff.

Checklist operacional rápido:
- consultar no máximo o arquivo-alvo do sintoma;
- usar janela curta (`offset/limit`) e evitar fan-out recursivo;
- registrar achado em 1–3 linhas no checkpoint;
- adiar varredura profunda para sessão pós-compact com contexto saudável.

## Proxy/index incremental para superfícies grandes (simple-first)

Para sustentar long-runs com baixo custo de contexto, usar **query surfaces** antes de leitura crua.

Ordem operacional recomendada:
1. **Board canônico (`.project/*`)**
   - preferir operações estruturadas (`append/update/query`) em vez de abrir blocos inteiros;
   - para loops de tarefa/verificação, usar superfície dedicada (`board_query`, `board_update`) com resposta curta e cache incremental;
   - fallback para leitura completa apenas quando a query não cobrir o caso.
2. **Sessões/logs (`.pi/agent/sessions/*.jsonl`)**
   - usar `session_analytics_query` como superfície padrão;
   - leitura deve ser bounded-by-default (janela de cauda + limite por linha/records) para evitar explosão de contexto.
3. **Fallback explícito**
   - quando leitura crua for inevitável, registrar no handoff o motivo, escopo e limite usado (`offset/limit` ou arquivo único).

Invariantes de segurança operacional:
- query determinística e reprodutível (mesmos parâmetros => mesma resposta);
- scan guard ativo para arquivos monstruosos (sem parse irrestrito);
- sempre preferir resumo/index para triagem inicial, aprofundando só no arquivo/slice que bloqueia progresso.

### Política structured-first para artefatos críticos

Quando o alvo for `.project/*.json`, a política padrão é **não** usar `edit`/`write` textual direto se houver superfície tipada equivalente.
O guardrail `structured-first` bloqueia mutações textuais nesses arquivos e registra auditoria `guardrails-core.structured-first-block` com o caminho recomendado.

Caminhos canônicos:
- `.project/tasks.json`: usar `board_query` para leitura curta e `board_update` para status/notas/milestone/rationale;
- `.project/verification.json`: usar `board_query` para leitura e `read-block`/`write-block` ou `structured_io` para evidência estruturada;
- outros `.project/*.json`: preferir `read-block`/`write-block` ou `structured_io` com dry-run e limite de blast-radius.

Fallback textual só é aceitável quando não existir superfície tipada suficiente; nesse caso, registrar no board/handoff o motivo, o escopo exato e a validação pós-mutação.

### Migração curta: `project_proxy_*` -> `board_*`

A superfície canônica de board usa apenas `board_query` e `board_update`.

Contratos úteis (rationale-aware):
- `board_query ... milestone="<label>"` filtra tasks/VER vinculada por milestone user-defined (release, épico ou janela operacional, sem semântica fixa no core).
- `board_query ... needs_rationale=true` retorna apenas linhas sensíveis (refactor/test-change) ainda sem motivo comunicável registrado.
- `board_query ... rationale_required=true|false` permite auditar somente itens sensíveis ou não sensíveis, mantendo triagem determinística.
- `board_query ... rationale_consistency=<consistent|mismatch|single-source|none>` permite triagem direta de divergência task↔verification.
- payload de `board_query` inclui `rationaleSummary` (required/withRationale/missingRationale), `rationaleConsistencySummary` e `rationaleSource` por linha (`task-note|verification-evidence|none`) para fechamento rápido de dívida.
- `board_update ... milestone="<label>"` define milestone user-defined da task; `milestone=""` limpa o vínculo.
- `board_update ... rationale_kind=<refactor|test-change|risk-control|other> rationale_text="..."` grava nota canônica no ticket (`[rationale:<kind>] ...`) para manter trilha auditável junto de VER.
- `board_update ... sync_rationale_to_verification=true` replica o rationale no `evidence` da VER vinculada (`task.verification`) quando houver, para manter task/VER alinhadas.
- `board_update ... require_rationale_for_sensitive=true` bloqueia update quando a task é sensível e continua sem rationale após aplicar payload (reason=`rationale-required-for-sensitive-task`).
- `board_update ... require_rationale_consistency=true` bloqueia update quando kind do rationale em task e VER vinculada divergem (reason=`rationale-consistency-mismatch`).
- ao marcar `status=completed`, `board_update` aplica por padrão gate de rationale para task sensível (reason=`rationale-required-to-complete-sensitive-task`); override explícito: `require_rationale_on_complete=false`.
- ao marcar `status=completed`, `board_update` também aplica por padrão gate de consistência task↔VER (reason=`rationale-consistency-required-to-complete-task`); override explícito: `require_rationale_consistency_on_complete=false`.
- `board_update` retorna `verificationSync` (`updated|already-present|missing-task-verification|not-found|skipped`) para auditoria rápida da propagação em VER.
- quando `sync_rationale_to_verification=true` sem payload de rationale, update falha com `sync-requires-rationale-payload` (evita sync ambíguo).

Substituição direta:
- `project_proxy_query` -> `board_query`
- `project_proxy_update` -> `board_update`

Contrato de rollout:
- novos fluxos **não** devem usar nomes `project_proxy_*`;
- automações legadas devem migrar por substituição 1:1 dos nomes (mesmos parâmetros principais);
- se houver runbook antigo com `project_proxy_*`, atualizar para `board_*` antes de marcar a trilha como estável.

## Remediação de artefatos pi já commitados (sem perder progresso)

Quando descobrir que um artefato efêmero entrou no git por engano:

### Cenário A — remediação leve (recomendado por padrão)

Use quando não há dado sensível e o objetivo é apenas parar de versionar.

1. confirmar trabalho local antes de qualquer ação:
   - `git status --short`
2. conferir violações da policy:
   - `npm run pi:artifact:audit`
3. remover do índice sem apagar cópia local:
   - `git rm --cached -- <path>`
4. garantir ignore para recorrência (`.gitignore`/baseline)
5. validar novamente:
   - `npm run pi:artifact:audit:strict`

### Cenário B — remediação pesada (histórico)

Use somente com confirmação explícita quando houver exposição sensível real.

1. rotacionar credenciais primeiro;
2. planejar rewrite de histórico (janela coordenada com time);
3. executar purge seletivo e comunicar force-push;
4. revalidar baseline com `pi:artifact:audit:strict`.

> Regra de pragmatismo: prefira Cenário A sempre que possível; Cenário B só quando o risco justificar custo operacional.

## Higiene de scripts ad-hoc (.sandbox/tmp)

Para reduzir gordura operacional sem perder rastreabilidade:

1. **Classificar por intenção**
   - `keep`: utilitário recorrente (nome estável + uso repetido em sessões);
   - `archive`: útil só como evidência de investigação pontual;
   - `remove`: script descartável sem valor de reprodução.
2. **Critério de permanência (keep)**
   - deve ter propósito claro, entrada/saída previsível e não depender de caminho hardcoded de sessão única;
   - idealmente substituir por superfície canônica (`board_query`, `session_analytics_query`, tools first-party) quando existir.
3. **Política de runtime artifacts**
   - arquivos efêmeros de runtime (`.pi/*.json` de sessão/loop) permanecem **fora de versionamento**;
   - podem ser mantidos localmente para operação, mas não entram em commit.
4. **Evidência mínima no board**
   - registrar no `notes` da task de higiene o inventário resumido (`keep/archive/remove`) e o rational em 1–3 linhas.

### Higiene de superfície distribuída (lab x usuários)

A higiene operacional não é só `sandbox`; inclui o que está sendo distribuído para usuários.

Regras:
- **paridade por padrão**: o que usamos no laboratório deve refletir o que distribuímos (mesmo contrato operacional), salvo exceção explícita;
- **exceção documentada**: tool/surface "lab-only" deve ter motivo, janela de validade e critério de graduação/remoção;
- **sinal de operação**: quando um utilitário ad-hoc virar recorrente, promover para surface canônica (tool/comando/monitor) com evidência e runbook;
- **evitar drift**: revisar periodicamente diferenças entre superfície local e distribuída e registrar backlog quando houver desvio intencional;
- **outcome-agnostic + simple-first**: distribuição deve atender usuário iniciante (fluxo direto/manual) e usuário avançado (fábrica/board/control-plane) sem exigir adoção imediata da camada avançada;
- **progressive disclosure**: features de governança avançada entram por opt-in e com trilha curta de onboarding.

Slimming/deprecation-by-default:
- `strict-curated` é o baseline oficial de distribuição simples;
- `curated-runtime` adiciona capacidades long-run/control-plane somente por opt-in;
- `stack-full` preserva laboratório/compatibilidade, mas não deve ser tratado como experiência inicial do usuário;
- superfície recorrente sem uso claro deve virar docs-only/runbook ou ser arquivada até haver evidência de valor operacional.

## Política de retomada pós-compactação
Retomar apenas com:
1. `.project/handoff.json`
2. `.project/tasks.json`
3. checkpoint curto em `docs/research/...` (se houver)

Se esses três estiverem íntegros, não é necessário reconstruir contexto narrativo longo.

### Cadência adaptativa pós-resume (anti-timidez residual)
Após auto-compact/auto-resume, a cadência **não** deve herdar micro-slice por inércia.

Contrato operacional:
- consultar `context_watch_status` ao retomar;
- usar `operatingCadence` como fonte de verdade de ritmo:
  - `standard-slices` => retomar throughput normal (ex.: 2–4 arquivos + testes focados);
  - `micro-slice-only` => manter cortes mínimos até checkpoint/compact estabilizar;
- usar `postResumeRecalibrated=true` como evidência de que houve retorno para ritmo padrão após pressão anterior (`warn/checkpoint/compact`);
- quando auto-resume for suprimido, inspecionar `autoCompact.autoResumeLastDecisionReason` / linha `auto-resume-last` em `/context-watch` para confirmar se a causa foi `reload-required`, `checkpoint-evidence-missing`, `pending-messages`, `recent-steer`, `lane-queue-pending` ou cooldown/off.
- usar `autoResumeLastDecisionHint`/`auto-resume-last hint` para ação imediata sem mapear reason manualmente.
- em supressões críticas (`reload-required`, `checkpoint-evidence-missing`) o runtime pode emitir notify warning explícito para evitar silêncio operacional.
- prompt de auto-resume usa normalização canônica (single-line, sem artefatos markdown/backticks) e truncamento explícito com preservação de cauda (`[snip] ... [truncated:+N chars]`, `[auto-resume-prompt-truncated:+N chars]`) para evitar reticências opacas e manter contexto operacional útil.
- quando `current_tasks` não vier no handoff, o prompt tenta derivar `focusTasks` por IDs `TASK-*` presentes em `next_actions`/`blockers`/`context`, mantendo limite curto e dedupe.
- quando alguma lista estoura limite (tasks/blockers/next), o prompt explicita overflow com `(+N more)` em vez de silêncio implícito.
- em triagem de qualidade de prompt, consultar audit `context-watchdog.auto-resume-prompt` para diagnosticar dedupe/truncation por seção (`tasks`, `blockers`, `nextActions`) antes de ajustar contrato de handoff.

Objetivo: preservar segurança do contexto sem exigir confirmação humana para continuar quando o estado já está saudável.

### Milestone mode (control-plane long-run)
Para rodar um milestone quase unattended no control plane, operar com um contrato explícito:

- **semântica de milestone é user-defined**: pode ser release (minor/patch), épico interno, janela operacional ou outro alvo local; o fluxo não assume release específica.
- **main quests**: manter 1–3 tasks P0/P1 como trilha principal (exemplos locais: `TASK-BUD-119`, `TASK-BUD-141`, `TASK-BUD-155`, `TASK-BUD-156`);
- **side quests**: intercalar slices curtos de preparo/primitive-first (`TASK-BUD-144/145/146/149/153`) apenas quando não quebrar continuidade da trilha principal;
- **stop conditions válidas**: (a) dúvida de requisito não resolvível por default seguro, (b) risco de segurança/perda de dados, (c) reload necessário para ativar código novo, (d) falha de teste sem mitigação segura no lote;
- **prova obrigatória**: todo incremento técnico do milestone precisa terminar com smoke focal verde (evidence em `verification`) antes de avançar para o próximo bloco;
- **cadência recomendada**: lotes de 10–50 micro-slices, com checkpoint em board (`notes`) + `VER-*` parcial por lote;
- **higiene de runtime**: preservar política `board-first`, steering do usuário com precedência, e usar `/lane-queue status` + `/context-watch` como telemetria passiva antes de escalar intervenção humana.

Resultado esperado: maior autonomia operacional sem perder previsibilidade, auditabilidade e controle de risco.

### Pre-compact calm-close (anti-paralisia)
Quando `context_watch_status.level=compact`, o fechamento deve ser calmo (sem pânico e sem travar):

- observar no payload de `autoCompact`:
  - `progressPreservation` / `progressPreservationSummary` (se o progresso está salvo, se há checkpoint compacto ou se precisa checkpoint)
  - `calmCloseReady`
  - `checkpointEvidenceReady`
  - `deferCount`/`deferThreshold`
  - `antiParalysisTriggered`
  - `calmCloseRecommendation`
- regra prática:
  1. finalizar o micro-slice em curso;
  2. evitar abrir novos blocos amplos;
  3. deixar a sessão em idle para o auto-compact disparar.
- hard intent de continuidade (escopo long-run): antes de perder memória por compactação, verificar `progressPreservation.progressSaved=true` **ou** `progressPreservation.status=will-auto-persist`; se ambos falharem, escrever handoff/checkpoint curto antes de aceitar compact.
- em `compact`, quando `autoResumeAfterCompact=yes` e `compact-checkpoint-persist: recommended=yes` (ver `/context-watch status`), persistir handoff antes de encerrar/parar mesmo quando houver cooldown de announce/checkpoint.
- para stop deterministicamente comunicável, consultar `deterministic-stop` (status/tool): `required=yes` com `reason=reload-required` ou `reason=compact-checkpoint-required` sinaliza pausa imediata para reload/compact com checkpoint.
- usar também `deterministicStopHint`/`deterministic-stop hint` para ação direta sem interpretação adicional (ex.: executar `/reload`).
- `operatorAction`/`operator-action` agrega a decisão operacional em formato curto (`kind`, `blocking`, `cmd` opcional), reduzindo parse manual dos motivos brutos.
- quando `deferCount` atingir o threshold repetidamente, tratar como sinal anti-paralisia: registrar recomendação auditável e priorizar checkpoint + idle compact em vez de manter adiamento indefinido.
