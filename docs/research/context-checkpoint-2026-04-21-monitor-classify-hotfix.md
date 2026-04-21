# Context checkpoint — monitor classify hotfix (isolated) — 2026-04-21

## Contexto
Sessão rodando em modo isolado confirmado (`pi:isolated:status` => `active mode: isolated ✅`).

## Hotfix aplicado
Arquivo:
- `node_modules/@davidorex/pi-behavior-monitors/dist/index.js`

Mudança em `classifyViaAgent(...)`:
- antes: chamada `complete(...)` enviava apenas `messages` + `tools`
- agora: envia também `systemPrompt: compiled.systemPrompt`

Racional:
- no provider `openai-codex` (Responses), ausência de instructions/system prompt pode retornar `{"detail":"Instructions are required"}`;
- o agent spec já define `prompt.system`, mas esse valor não estava sendo passado no classify path.

## Smoke rápido (isolado)
- baseline `monitors_compact_status`: `classifyFail=2`
- 3 tool events de smoke (`bash/read/bash`)
- pós-smoke `monitors_compact_status`: `classifyFail=2` (sem incremento)

## Nota
Hotfix local de runtime (node_modules). Para persistência/release, ideal upstream/fork com correção equivalente no pacote `@davidorex/pi-behavior-monitors`.
