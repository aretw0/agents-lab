# AFK materialization patterns (long-run, low-iteration)

Data: 2026-05-02  
Task: `TASK-BUD-572`  
Escopo: síntese local bounded de influências para manter o board abastecido antes/durante runs AFK (away from keyboard), sem auto-dispatch.

## Objetivo

Transformar boas influências do ecossistema em um contrato simples:

- gerar material útil de backlog com baixa iteração humana;
- manter governança local-first/fail-closed;
- evitar long-run “vazio” (execução longa sem matéria-prima).

## Fontes locais analisadas

1. `docs/research/claude-code-brainstorm-ecosystem-assimilation-2026-05-01.md`
   - valor principal: brainstorm como pipeline operacional (não ideação solta).
2. `docs/superpowers/plans/2026-04-16-quota-panel-tui.md`
   - valor principal: plano task-by-task com checklist explícita para manter execução longa ocupada.
3. `docs/research/control-plane-delegation-wave-2026-05.md`
   - valor principal: evolução report-first + fail-closed + recommendationCode estável.

## Padrões assimiláveis (com adaptação local-first)

### 1) Material-first antes de throughput

Influência: brainstorm de Claude Code como gerador de lane.  
Adaptação local: não iniciar ciclo AFK longo sem lote local-safe já semeado no board.

Regra prática:
- mínimo de 3–7 fatias locais com validação conhecida;
- se abaixo do mínimo, parar para semear backlog (não forçar execução).

### 2) Loop divergir -> convergir -> fatiar -> semear

Influência: estrutura de brainstorm útil por estágios.  
Adaptação local:
1. divergir bounded (ideias limitadas),
2. convergir por valor/risco/esforço,
3. fatiar com validação/rollback,
4. semear via decisão humana explícita.

### 3) Plano com checklist curta e verificável

Influência: estilo superpowers de plano executável por checkboxes.  
Adaptação local:
- manter steps curtos e observáveis;
- cada step com gate de validação explícito;
- permitir pausa/restart sem perder estado.

### 4) Report-first como default operacional

Influência: wave de delegação com packets read-only e recommendationCode estável.  
Adaptação local:
- decisão sempre explícita antes de dispatch;
- packets/telemetria guiam ação, mas não executam por conta própria.

## Anti-padrões a evitar

- brainstorm sem convergência (vira repetição);
- backlog inchado sem critérios de execução;
- long-run contínuo sem material novo de board;
- “pronto para start” interpretado como autorização automática.

## Contrato AFK proposto (resumo)

1. **Entrada AFK**: `simple_delegate_rehearsal_packet` e `simple_delegate_rehearsal_start_packet` verdes para decisão humana.
2. **Abastecimento**: `lane_brainstorm_packet` + `lane_brainstorm_seed_preview` + semeadura humana quando estoque de fatias cair.
3. **Execução**: batches pequenos com commit/checkpoint por fatia.
4. **Parada**: stop imediato em protected/risk/reload/validation unknown.
5. **Saída**: postflight com `go|no-go`, blockers e próxima ação segura.

## Decisão desta síntese

A trilha AFK produtiva depende mais de **materialização contínua do board** do que de “autonomia bruta”. O caminho robusto é combinar brainstorm bounded, semeadura visível e execução local-safe curta com checkpoints frequentes.

## Fechamento da wave AFK materialization (TASK-BUD-572..575)

### Entregas consolidadas
- `TASK-BUD-572`: síntese bounded de influências (pi/Claude Code/superpowers) para materialização contínua.
- `TASK-BUD-573`: runbook de alimentação contínua (`brainstorm -> seed preview -> batch local-safe`) com stop por estoque baixo.
- `TASK-BUD-574`: packet read-only `autonomy_lane_material_readiness_packet` (`continue|seed-backlog|blocked`).
- `TASK-BUD-575`: regressão focal + closeout operacional.

### Indicadores operacionais mínimos (AFK)
- estoque local-safe com validação conhecida: **>= 3** fatias;
- alvo saudável para continuidade: **3–7** fatias prontas;
- abaixo do mínimo: `stop: backlog-material-insuficiente` + semeadura explícita;
- packet de prontidão deve refletir `seed-backlog` antes de qualquer tentativa de ampliar run.

### Decisão de continuidade
- go: continuar AFK em batches pequenos quando packet indicar `continue`;
- no-go: se `seed-backlog|blocked`, interromper continuidade e priorizar materialização do board.

## Fechamento da wave AFK continuity (TASK-BUD-576..579)

### Entregas consolidadas
- `TASK-BUD-576`: resumo curto de material readiness no `context_watch_continuation_readiness` (`material=<decision>` + `details.materialReadiness`).
- `TASK-BUD-577`: packet report-only de semeadura `autonomy_lane_material_seed_packet` (`seed-now|wait|blocked`).
- `TASK-BUD-578`: template curto de handoff material-first (`afk-handoff: decision/stock/blockers/next`).
- `TASK-BUD-579`: regressão focal e closeout operacional da wave.

### Pack focal reproduzível (comando único)
```bash
npx vitest run packages/pi-stack/test/smoke/context-watchdog-continuation.test.ts packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts packages/pi-stack/test/smoke/control-plane-doc-checklist.test.ts
```
Resultado esperado nesta wave: **30 passed (3 files)**.

### Regra operacional explícita (continue vs seed-backlog)
- continuar (`continue`): estoque validado >= mínimo e foco com validação conhecida.
- semear (`seed-backlog`/`seed-now`): estoque abaixo do mínimo alvo ou cobertura insuficiente.
- bloquear (`blocked`): foco inválido, risco/protected/reload-dirty ou gate crítico desconhecido.

### Próximo foco recomendado
- manter WIP=1 e seguir para hardening de long-run em pressão de máquina (`TASK-BUD-580`: CPU signal no gate de manutenção).
