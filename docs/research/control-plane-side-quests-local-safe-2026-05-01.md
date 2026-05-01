# Side quests local-safe derivados da matriz anti-bloat

Data: 2026-05-01  
Origem: `docs/research/control-plane-pattern-matrix-2026-05-01.md`

## Critério de desenho

Cada side quest deve ter:

- alvo pequeno e reversível;
- validação focal antes de merge local;
- rollback explícito (`git revert commit`);
- nenhum escopo protegido por padrão.

## Lote proposto (P1 → P2)

### SQ-1 (P1) — Dedupe semântico de status no monitor summary

- **Objetivo:** reduzir repetição textual quando o estado não muda semanticamente.
- **Validação focal:** smoke test de summary + contrato de campos canônicos.
- **Rollback:** revert commit único do ajuste.

### SQ-2 (P1) — Output shaping adaptativo com cooldown no context-watch

- **Objetivo:** reduzir ruído em `warn/checkpoint` sem perder `recommendationCode/nextAction`.
- **Validação focal:** smoke de context-watch + contrato cross-surface.
- **Rollback:** revert commit único do ajuste.

### SQ-3 (P1) — Memória curta por fatia no handoff

- **Objetivo:** checkpoints compactos por slice com links canônicos.
- **Validação focal:** smoke de handoff/continuation readiness.
- **Rollback:** revert commit único do ajuste.

### SQ-4 (P2) — Expansão de regressões single-source docs

- **Objetivo:** cobrir mais guias críticos além de doctrine/glossary.
- **Validação focal:** marker-check + smoke de docs.
- **Rollback:** revert commit único do ajuste.

### SQ-5 (P2) — Contrato de microcopy para preview expandível

- **Objetivo:** preservar identidade textual de expansão futura: `(N earlier lines, ctrl+o to expand)`.
- **Validação focal:** snapshot/smoke textual em superfície de preview.
- **Rollback:** revert commit único do ajuste.
