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
- para observação operacional, `/lane-queue status` deve expor `runtimeCode=<active|reload-required|unknown>`, `boardAutoGate=<reason>`, `boardAutoLast=<task@age|n/a>` e marcadores `PREPARADO/ATIVO_AQUI/EM_LOOP` para diagnosticar por que o auto-advance não disparou (incluindo `dedupe-window` quando a mesma task foi disparada há pouco).
- quando `boardAutoGate != ready`, registrar auditoria throttled (`guardrails-core.board-intent-auto-advance-deferred`) com razão e contexto mínimo para evidência de runtime sem spam.
- eventos de auto-advance (`...auto-advance`, `...auto-advance-deferred`, `...auto-advance-failed`) devem carregar `runtimeCodeState` para comprovar se o comportamento observado já está com código ativo (`active`) ou ainda depende de reload (`reload-required`).
- o runtime deve emitir `guardrails-core.loop-activation-state` (throttled por mudança de label) para registrar transições dos marcadores `PREPARADO/ATIVO_AQUI/EM_LOOP` sem depender de comando manual.
- quando houver transição para `EM_LOOP=yes`, emitir `guardrails-core.loop-activation-ready` uma vez por transição para facilitar detecção de “loop liberado” em tempo real.
- quando `EM_LOOP=no`, expor `loopHint` alinhado ao `blocker` (reload/queue/gate/loop-state) para correção rápida sem investigação ampla.
- `/lane-queue status` deve exibir `loopReadyLast` e `loopReadyLabel` para evidenciar a última transição de loop liberado dentro da sessão atual.
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

### Steering signal-first (tool-surface diet)

No loop canônico, steering diário deve priorizar **sinais passivos de stream/status** (ex.: `warn/checkpoint/compact`, `operatorSignal`) em vez de depender de tool-call manual.

Regras operacionais:
- `context_watch_status` fica como superfície de **diagnóstico explícito** (debug/inspeção), não como passo obrigatório por iteração;
- no segundo `warn` consecutivo, a cadência deve escalar para checkpoint/handoff automático antes do compact;
- sinais de intervenção humana (`reload-required`, `handoff-refresh-required`) devem aparecer no stream para evitar surpresa de controle.

### Bloat-smell advisory (calibrado, baixo ruído)

Objetivo: preservar throughput de fábrica sem inflar resposta/código em silêncio.

Regras operacionais:
- manter bloat-smell em modo **advisory passivo** por padrão (status/audit; sem hard-block);
- sinais de runtime esperados:
  - texto: `guardrails-core-bloat`
  - código: `guardrails-core-bloat-code`
- manter `notifyOnTrigger=false` durante calibração inicial; promover para notify apenas após estabilidade de sinal/ruído;
- para scouts (`scout burst`), usar bloat-smell para mapear hotspots de split/síntese, mas registrar recomendação no board antes de escalar enforcement;
- quando disparar smell recorrente, converter em micro-slice explícito (split de tarefa/arquivo) em vez de tratar como ruído transitório.

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
- usar `postResumeRecalibrated=true` como evidência de que houve retorno para ritmo padrão após pressão anterior (`warn/checkpoint/compact`).

Objetivo: preservar segurança do contexto sem exigir confirmação humana para continuar quando o estado já está saudável.
