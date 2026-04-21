# Context preload pack — 2026-04-21

## Objetivo
Reduzir re-leitura repetitiva pós-compactação/resume, gerando um pack de contexto mínimo com base em telemetria real de `read` nas sessões recentes.

## Implementação
- Script novo: `scripts/context-preload-pack.mjs`
- Atalhos:
  - `npm run context:preload`
  - `npm run context:preload:write`
- Output persistente (opt-in): `.sandbox/pi-agent/preload/context-preload-pack.json`

## Evidência de execução
Comando:
```bash
node scripts/context-preload-pack.mjs --days 1 --limit 8 --top 16 --write --json
```

Resumo observado (janela atual):
- `totalReadCalls`: 843
- top 3 leituras:
  1. `packages/pi-stack/extensions/monitor-provider-patch.ts` (47)
  2. `.project/tasks.json` (45)
  3. `packages/pi-stack/test/monitor-provider-patch.test.mjs` (34)
- pack sugerido:
  - `controlPlaneCore`: 10 arquivos
  - `agentWorkerLean`: 6 arquivos

## Decisão operacional associada
- `DEC-BUD-028`: onboarding dual-mode (`.project-first` vs adapter-first).
- `REQ-BUD-034`: suporte a espelho humano opcional (`.project` -> Markdown/Obsidian), mantendo canônico.
- Referência de template para vault: https://github.com/aretw0/vault-seed

## Leitura prática
- O que mais se repete pode ser pré-carregado antes de spawn/resume.
- O pack deve ser recalculado por checkpoint/compact (ou no máximo a cada 24h) para manter frescor.
