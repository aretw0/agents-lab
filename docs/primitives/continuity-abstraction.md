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
3. **No auto-close estratégico**: conclusão final depende de decisão humana quando gate exigir.
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
| Markdown/Obsidian | notas + frontmatter/checklists | task/event/evidence projetados em markdown estruturado | ótimo para captura/inbox e espelho humano |
| SQLite/local app | tabelas/event journal | replay + auditoria robusta | útil para runners e automação local |

---

## Adapter de referência: Markdown/Obsidian (caixa de notas)

Regras mínimas do adapter:

- mapear `task` para nota com frontmatter estável (`id`, `status`, `priority`, `dependsOn`);
- mapear `event` para journal append-only na nota (ou arquivo de eventos);
- mapear `evidence` para bloco estruturado com `id/status/method/timestamp`;
- manter `decisionGate` explícito (`no-auto-close`, `requiresHumanApproval`).

O adapter pode ser **inbox-first** (captura) ou **mirror-first** (projeção), sem substituir o contrato canônico.

---

## Estado no agents-lab

- adapter canônico local: `.project/*`;
- governança hard ativa no control-plane (`intent`, `verification`, `no-auto-close`);
- trilha de expansão: adapters externos (GitHub/Gitea/Markdown/Obsidian/SQLite) sem alterar semântica.

## Próximos incrementos

1. versionar formalmente o schema do contrato (`task/event/intent/evidence`);
2. publicar mapa translacional de adapters (campo por campo);
3. validar round-trip em pelo menos 2 adapters (ex.: `.project` + Markdown/Obsidian);
4. promover decision packet para fechamento humano em tasks estratégicas.
