# TASK-BUD-075 closure note — 2026-04-21

## Escopo
Adicionar detector de capability/tool gaps no `session-triage` para produzir claim candidates acionáveis antes da execução principal.

## Entregas
- `scripts/session-triage.mjs`
  - `toolingGaps` por sessão
  - `aggregate.toolingGaps` e `aggregate.toolingClaims` no JSON
  - seção humana `Tooling blockers (claim candidates)`
- `docs/guides/session-triage.md`
  - uso operacional da primitiva capability-gap-claim
- `docs/primitives/capability-gap-claim.md`
  - contrato mínimo e invariantes
- `docs/primitives/README.md`
  - catálogo atualizado

## Evidência
- `node scripts/session-triage.mjs --days 1 --limit 4`
- `node scripts/session-triage.mjs --days 1 --limit 2 --json`
  - presença de `toolingGaps` e `toolingClaims` no output.

## Conclusão
Primitiva transversal habilitada para scouts/coordenadores detectarem lacunas de ferramenta cedo e exigirem bootstrap/permissão antes de lotes autônomos.
