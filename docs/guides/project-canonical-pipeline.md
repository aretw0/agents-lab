# Pipeline canônico de posteridade (.project-first)

Objetivo: preservar contexto de forma durável e retomável com baixo custo.

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

## Política no-obvious-questions no loop canônico

Para manter velocidade de cruzeiro em long-run:
- ambiguidades de baixo risco devem ser resolvidas por default seguro/determinístico;
- interrupção do usuário apenas em risco irreversível/perda de dados/conflito de objetivo;
- assunções automáticas devem ficar auditáveis no runtime (`guardrails-core.pragmatic-assumption-applied`) e refletidas no board quando impactarem decisão de tarefa.

### Discoverability operacional da lane-queue

Política operacional atual: **native-first**.

Durante long-run:
- priorizar steer/follow-up nativo (`Alt+Enter` / `app.message.followUp`) para continuidade de turno;
- usar `lane-queue` apenas como trilha **opt-in** para deferimento cross-turn em janela idle;
- quando `lane-queue` for usada, `/lane-queue` (status) deve orientar ações concretas com `queued>0` (`list`/`clear`) e `/lane-queue help` deve manter discoverability imediata;
- para board-first unattended, usar `/lane-queue board-next`: seleciona deterministicamente a próxima task elegível (`planned + deps satisfeitas + prioridade [P0..Pn] + id`) e injeta intent canônico com contrato `no-auto-close + verification`.
- auto-advance só deve ocorrer em condição segura (`lane idle` + `queue empty` + `loop running/healthy` + `stopCondition=none` + board ready com `nextTaskId`), com dedupe de task e auditoria explícita.
- para observação operacional, `/lane-queue status` deve expor `runtimeCode=<active|reload-required|unknown>`, `boardAutoGate=<reason>`, `boardAutoLast=<task@age|n/a>`, `evidenceBoardAuto=<task@age runtime emLoop|n/a>`, `evidenceLoopReady=<age runtime gate|n/a>` e marcadores `READY/ACTIVE_HERE/IN_LOOP` para diagnosticar por que o auto-advance não disparou (incluindo `dedupe-window` quando a mesma task foi disparada há pouco).
- quando `boardAutoGate != ready`, registrar auditoria throttled (`guardrails-core.board-intent-auto-advance-deferred`) com razão e contexto mínimo para evidência de runtime sem spam.
- eventos de auto-advance (`...auto-advance`, `...auto-advance-deferred`, `...auto-advance-failed`) devem carregar `runtimeCodeState` para comprovar se o comportamento observado já está com código ativo (`active`) ou ainda depende de reload (`reload-required`).
- o runtime deve emitir `guardrails-core.loop-activation-state` (throttled por mudança de label) para registrar transições dos marcadores `READY/ACTIVE_HERE/IN_LOOP` sem depender de comando manual.
- quando houver transição para `IN_LOOP=yes`, emitir `guardrails-core.loop-activation-ready` uma vez por transição para facilitar detecção de “loop liberado” em tempo real.
- quando `IN_LOOP=no`, expor `loopHint` alinhado ao `blocker` (reload/queue/gate/loop-state) para correção rápida sem investigação ampla.
- compatibilidade retroativa: snapshots/evidências antigas podem conter `PREPARADO/ATIVO_AQUI/EM_LOOP`; tratar `markersLabel` como texto histórico e usar campos estruturados (`runtimeCodeState`, `emLoop`, `boardAutoAdvanceGate`) como contrato canônico de decisão.
- `/lane-queue status` deve exibir `loopReadyLast` e `loopReadyLabel` para evidenciar a última transição de loop liberado dentro da sessão atual.
- `/lane-queue evidence` deve mostrar o snapshot persistido mais recente (`boardAuto`/`loopReady`) para comprovação rápida sem varredura de JSONL, incluindo `readyForTaskBud125=yes|no` e critérios explícitos (`runtime active` + `emLoop=yes`).
- para gate operacional fora do TUI, usar `npm run ops:loop-evidence:check` (humano) e `npm run ops:loop-evidence:strict` (CI/rollback gate) sobre `.pi/guardrails-loop-evidence.json` com janela de frescor explícita.
- intents canônicos devem usar envelope tipado (`[intent:<type>]` + campos `key=value`, ex.: `board.execute-task` e `board.execute-next`) para reduzir fragilidade de dispatch textual e manter auditabilidade entre extensões.
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
- status da lane continua mostrando `failStreak=n/<threshold>` para decisão rápida do operador;
- quando o retry transitório esgotar, o status deve sinalizar `nextDrain=stopped:retry-exhausted` com 3 ações curtas: diagnosticar providers (`/provider-readiness-matrix`), opcionalmente trocar (`/handoff --execute ...`) e retomar (`/lane-queue resume`).

### Configuração operacional sem editar JSON manualmente

Para ajustes frequentes de runtime (long-run queue + autonomia pragmática), preferir comando dedicado:

- `/guardrails-config status`
- `/guardrails-config get <key>`
- `/guardrails-config set <key> <value>`

Exemplos:
- `/guardrails-config get longRunIntentQueue.maxItems`
- `/guardrails-config set longRunIntentQueue.maxItems 80`
- `/guardrails-config set longRunIntentQueue.enabled true`

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
- comando dry-first para operador: `/safe-mutation` (`help`, `large-file`, `query`) com audit trail (`guardrails-core.safe-mutation.*`);
- seed de I/O estruturado (loam-inspired): `guardrails-core-structured-io.ts` com `structuredJsonRead`/`structuredJsonWrite` e selector canônico;
- reexport de structured I/O em `guardrails-core.ts` para consumo unificado (`parseStructuredJsonSelector`, `structuredJsonRead`, `structuredJsonWrite`);
- comando operador `/structured-io` (`json-read`, `json-write`) com dry-run default, cap de blast-radius e audit trail (`guardrails-core.structured-io.*`);
- tool tipada `structured_io_json` (`read|set|remove`) para consumo determinístico por agentes/workflows, também dry-first por default;
- smokes de contrato/superfície: `guardrails-safe-mutation-contract.test.ts`, `guardrails-safe-mutation-reexport.test.ts`, `guardrails-safe-mutation-registration.test.ts`, `guardrails-structured-io-contract.test.ts`, `guardrails-structured-io-command.test.ts`, `guardrails-structured-io-tool.test.ts`.

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
- quando `notify=false`, `warn` permanece em fallback de status (sem silêncio);
- `checkpoint/compact` continuam notificados como sinal crítico mesmo com `notify=false`;
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
- **operator**: sinais de ação humana imediata (ex.: `reload-required`, `handoff-refresh-required`).
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

### Migração curta: `project_proxy_*` -> `board_*`

A superfície canônica de board usa apenas `board_query` e `board_update`.

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
- quando auto-resume for suprimido, inspecionar `autoCompact.autoResumeLastDecisionReason` / linha `auto-resume-last` em `/context-watch` para confirmar se a causa foi `pending-messages`, `recent-steer`, `lane-queue-pending` ou cooldown/off.
- prompt de auto-resume usa normalização canônica (single-line, sem artefatos markdown/backticks) e truncamento explícito (`[truncated:+N chars]`, `[auto-resume-prompt-truncated:+N chars]`) para evitar reticências opacas.
- em triagem de qualidade de prompt, consultar audit `context-watchdog.auto-resume-prompt` para diagnosticar dedupe/truncation por seção (`tasks`, `blockers`, `nextActions`) antes de ajustar contrato de handoff.

Objetivo: preservar segurança do contexto sem exigir confirmação humana para continuar quando o estado já está saudável.

### Pre-compact calm-close (anti-paralisia)
Quando `context_watch_status.level=compact`, o fechamento deve ser calmo (sem pânico e sem travar):

- observar no payload de `autoCompact`:
  - `calmCloseReady`
  - `checkpointEvidenceReady`
  - `deferCount`/`deferThreshold`
  - `antiParalysisTriggered`
  - `calmCloseRecommendation`
- regra prática:
  1. finalizar o micro-slice em curso;
  2. evitar abrir novos blocos amplos;
  3. deixar a sessão em idle para o auto-compact disparar.
- quando `deferCount` atingir o threshold repetidamente, tratar como sinal anti-paralisia: registrar recomendação auditável e priorizar checkpoint + idle compact em vez de manter adiamento indefinido.
