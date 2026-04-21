# Context checkpoint — sovereignty prep (2026-04-21)

Resumo curto do preparo feito com contexto limitado:

- isolamento confirmado (`active mode: isolated ✅`);
- decisão de abandonar estratégia de patch ad-hoc em `node_modules` como caminho final;
- guardrail anti-arquivo-venenoso implementado:
  - `scripts/repo-complexity-check.mjs`
  - `npm run repo:complexity`
  - `npm run repo:complexity:strict`
- baseline atual de arquivos >1000 linhas identificado para split pragmático (WIP=1).
- split inicial já aplicado:
  - `packages/pi-stack/extensions/monitor-provider-patch.ts` extraiu config para `monitor-provider-config.ts` (agora <1000 linhas);
  - `packages/pi-stack/test/monitor-provider-patch.test.mjs` extraiu helpers para `test/helpers/monitor-provider-patch-helpers.mjs` (agora <1000 linhas).

Arquivos críticos para quebra progressiva:
- `packages/pi-stack/extensions/colony-pilot.ts`
- `packages/pi-stack/extensions/quota-visibility.ts`
- `packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`

Próximo movimento: implementação first-party do fluxo classify de monitores sem dependência de patch em `node_modules`.
