# Pacote de maturidade — rehearsal local anti-bloat (control-plane)

Data: 2026-05-01  
Escopo: milestone `control-plane-long-run-prep` (execução local-safe, report-only).

## Objetivo do rehearsal

Validar continuidade de múltiplas fatias locais com:

- foco preservado;
- validação focal verde;
- commits pequenos e auditáveis;
- nenhum auto-desvio para escopo protegido.

## Evidência consolidada

### Fatias concluídas no rehearsal

`TASK-BUD-442` até `TASK-BUD-451` (10 tasks concluídas) com verificações `VER-BUD-795..803`.

### Commits principais do ciclo

- `67adbc0` — centralização de recommendation codes.
- `9b95b93` — hardening de limites/fallback do brainstorm packet.
- `7c83813` — desacoplamento de builder/continuation + regressões dedicadas.

### Verificações focais relevantes

- suites smoke de autonomy/context-watch/recommendation contract e lane brainstorm verdes;
- regressão docs anti-bloat (`control-plane-doc-checklist`) verde;
- marker-checks de síntese mdt/squeez/matriz/side-quests verdes.

## Métricas do rehearsal (local-first)

- **Fatias locais concluídas:** 10
- **Foco preservado:** sim
- **Smoke focal verde:** sim
- **Commits pequenos/intencionais:** sim
- **Handoff/checkpoint fresco:** sim
- **Protected scope auto-selection:** 0
- **Blockers pendentes:** 0

Resultado formal da gate:

- `unattended_rehearsal_gate(completed_local_slices=10, focus_preserved=true, focal_smoke_green=true, small_commits=true, handoff_fresh=true, protected_scope_auto_selections=0, unresolved_blockers=0)`
- decisão: **`ready-for-canary`** (score 6/6).

## Leitura operacional (sem promoção automática)

O resultado indica maturidade local para considerar canário controlado no futuro, **sem** autorizar mudança imediata de escopo. Mantém-se:

1. local-first como padrão;
2. escopo protegido apenas com decisão humana explícita;
3. continuidade por micro-slices com validação focal e rollback simples.

## Próxima fila local-safe

Itens já semeados para continuidade após rehearsal:

- `TASK-BUD-453` (dedupe semântico de status)
- `TASK-BUD-454` (output shaping adaptativo com cooldown)
- `TASK-BUD-455` (memória curta por fatia no handoff)
- `TASK-BUD-456` (expansão regressões single-source docs)
- `TASK-BUD-457` (contrato de microcopy `(N earlier lines, ctrl+o to expand)`)

## Atualização 2026-05-03 — night lane hard-intent

A trilha pós-rehearsal evoluiu para contrato runtime hard-intent na continuidade noturna:
- auto-advance de foco com fail-closed (`TASK-BUD-557`),
- telemetry e snapshot read-only (`TASK-BUD-558`, `TASK-BUD-559`),
- runbook batch 3–5 com stop/rollback explícitos (`TASK-BUD-560`),
- auto-advance de handoff no board quando sucessor é unívoco (`TASK-BUD-561`).

Leitura operacional: a maturidade local-safe aumentou sem abrir protected scope automático. Próxima promoção recomendada segue sendo rehearsal bounded de simple-delegate com decisão humana explícita para qualquer salto de escopo.

Atualização adicional (2026-05-03, lote prep): packet/surface/gate de simple-delegate rehearsal foram entregues em modo report-only (`TASK-BUD-563..566`) com regressão focal verde. A stack está pronta para rehearsal real de uma única task bounded, sem auto-dispatch e com fail-closed em blockers de auto-advance/capability.
