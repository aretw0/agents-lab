# Primitiva: Continuidade como Abstração (tracker-agnostic)

## Categoria

Memória / Coordenação / Governança

## Problema

Quando continuidade fica acoplada ao storage (chat local, `.project`, issue tracker, Markdown, DB), o fluxo quebra na troca de backend e os agentes perdem portabilidade.

## Objetivo

Definir um **contrato canônico** de coordenação que preserve a mesma semântica operacional em qualquer adapter.

---

## Contrato canônico v1 (mínimo)

Entidades obrigatórias:

1. **task**
   - `id`, `title/description`, `status`, `priority`, `dependsOn[]`, `owner?`
2. **event**
   - `id`, `taskId`, `kind`, `atIso`, `actor`, `payload`
3. **intent**
   - `id?`, `type`, `version`, `mode`, `contract`, `taskId?`, `payload?`
4. **evidence**
   - `id`, `target`, `status`, `method`, `timestamp`, `artifacts?`, `summary`
5. **decisionGate**
   - `noAutoClose`, `requiresVerification`, `requiresHumanApproval`
6. **deliveryState**
   - `reported | artifact-produced | applied | recovery-required`

### Transições de task (v1)

- `planned -> in-progress`
- `in-progress -> blocked | planned | completed`
- `blocked -> in-progress | planned`
- `completed` é terminal lógico (reabertura via evento explícito de rollback/reopen)

### Invariantes

1. **Backend-agnostic**: regra vale igual em `.project`, GitHub/Gitea, Markdown/Obsidian, SQLite.
2. **Runner-agnostic**: sessão local, TUI/WEB, CI runner.
3. **No auto-close estratégico**: conclusão final depende de decisão do operador quando gate exigir.
4. **Evidência obrigatória**: sem evidência mínima, estado final deve cair em `recovery-required`.
5. **Replay idempotente**: reprocessar eventos não corrompe estado.

---

## Camada de hard intent (sobre o contrato)

Hard intent **não depende de storage**. Ela opera sobre task/event/intent/evidence:

1. resolver próxima `task` elegível;
2. emitir `intent` canônico (`board-first`, contrato explícito);
3. registrar `event` de execução e progresso;
4. anexar `evidence` validável;
5. aplicar `decisionGate` antes de `completed`.

Resultado: mesmas regras de governança em qualquer adapter.

---

## Matriz mínima de adapters equivalentes

| Adapter | Persistência principal | Equivalência operacional | Observações |
|---|---|---|---|
| `.project` (local atual) | JSON blocks (`tasks/verification/handoff`) | referência canônica no workspace | baseline first-party local |
| First-party future backend | API/DB first-party | deve preservar mesmas entidades/transições | semântica > tecnologia |
| GitHub/Gitea trackers | issues/projects/milestones | mapear task/event/evidence por campos/labels/comments | requer política de sync e conflito |
| Markdown/Obsidian | notas + frontmatter/checklists | task/event/evidence projetados em markdown estruturado | ótimo para captura/inbox e espelho do operador |
| SQLite/local app | tabelas/event journal | replay + auditoria robusta | útil para runners e automação local |

---

## Adapter de referência: Markdown/Obsidian (caixa de notas)

Regras mínimas do adapter:

- mapear `task` para nota com frontmatter estável (`id`, `status`, `priority`, `dependsOn`);
- mapear `event` para journal append-only na nota (ou arquivo de eventos);
- mapear `evidence` para bloco estruturado com `id/status/method/timestamp`;
- manter `decisionGate` explícito (`no-auto-close`, `requiresHumanApproval`).

O adapter pode ser **inbox-first** (captura) ou **mirror-first** (projeção), sem substituir o contrato canônico.

### Idea Inbox Primitive

A captura de ideias livres deve produzir proposal antes de task final:

1. aceitar fontes Markdown/Obsidian e eventos de sessão;
2. normalizar para `proposal` com origem auditável;
3. gerar `taskDraft.status=planned` com descrição objetiva e AC mínimo;
4. exigir `decisionGate.requiresHumanApproval=true` antes de promover prioridade/scope;
5. nunca aplicar auto-close nem auto-priorização agressiva a partir do inbox.

---

## Estado no agents-lab

- adapter canônico local: `.project/*`;
- governança hard ativa no control-plane (`intent`, `verification`, `no-auto-close`);
- trilha de expansão: adapters externos (GitHub/Gitea/Markdown/Obsidian/SQLite) sem alterar semântica.

### Superfícies operacionais de continuidade (read-only)

Para continuidade sob pressão de contexto, a stack expõe sinais read-only de estágio e frescor:
- `context_watch_freshness_status` (preload + dirty);
- `context_watch_compact_stage_status` (estágio `normal|graceful-stop|force-compact`, reload gate e próximo passo determinístico);
- `auto_advance_hard_intent_telemetry` (evidência agregada de auto-advance `eligible|blocked` + reason codes fail-closed).

Essas superfícies mantêm `authorization=none` e `dispatchAllowed=false`, servindo como base de decisão do operador sem auto-dispatch.

### Sinal rastreável de estagnação

Quando a continuidade repete pressão de contexto sem avanço material, o contrato deve emitir um sinal auditável em vez de tentar avançar indefinidamente.

Campos mínimos do sinal:

- `decision`: `none | watch | pause-human-replan`;
- `reasonCode`: `no-stagnation | context-pressure-repeat`;
- `eventCount`: número de eventos recentes compatíveis com estagnação;
- `evidence`: blockers/snapshots recentes, incluindo checkpoint/compact/reload quando presentes;
- `humanActionRequired`: `true` quando o limiar exigir pausa e replanejamento pelo operador.

Regra local-safe atual: repetição de blockers transitórios de contexto (`context-watch-*`, checkpoint/compact/reload) por múltiplas janelas gera `pause-human-replan` advisory no `local_continuity_audit`. O sinal não autoriza dispatch, não conclui task e não cria auto-advance; ele congela a progressão automática até checkpoint/replanejamento explícito.

Evidência de implementação atual:

- superfície: `local_continuity_audit` inclui `stagnationSignal` report-only;
- regressão: `guardrails-unattended-continuation-surface.test.ts` cobre `stagnation=pause-human-replan events=2`;
- board: tasks podem registrar o sinal por note/verification antes de fechamento.

## Próximos incrementos

1. versionar formalmente o schema do contrato (`task/event/intent/evidence`);
2. publicar mapa translacional de adapters (campo por campo);
3. validar round-trip em pelo menos 2 adapters (ex.: `.project` + Markdown/Obsidian);
4. promover decision packet para fechamento pelo operador em tasks estratégicas.
