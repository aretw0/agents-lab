# Capability Gap Claim Primitive

Objetivo: quando faltar ferramenta/capability para executar um lote, registrar o bloqueio de forma estruturada e pedir bootstrap/permissão antes da execução principal.

## Problema
Sem uma primitiva explícita, erros como `command not found`, `ENOENT` e `missing capabilities` aparecem tarde, durante execução, gerando retrabalho e baixa previsibilidade.

## Contrato mínimo

Entrada (sinais):
- erros de executável/comando (`command not found`, `ENOENT`)
- gaps de capability/preflight (`missing capabilities`, `missing executables`)
- blockers de contrato (`Instructions are required`)

Saída (claim candidate):
- `code`: tipo do gap
- `count`: incidência no recorte
- `recommendation`: ação de bootstrap/remediação

## Estados sugeridos
1. `detected` — gap identificado
2. `claimed` — pedido explícito de bootstrap/permissão aberto
3. `approved` — remediação autorizada
4. `resolved` — gap removido com evidência
5. `rejected` — execução cancelada ou redirecionada

## Invariantes
- não iniciar lote autônomo crítico com claim aberta sem resolução;
- manter trilha auditável no board canônico (`verification`/`handoff`);
- primitiva é backend-agnostic (serve para `.project`, trackers externos e fluxos markdown).

## Superfície atual
- `scripts/session-triage.mjs` produz `toolingGaps` + `toolingClaims` para suporte operacional inicial.
