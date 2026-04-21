# Monitor stability evidence (2026-04-21)

## O que foi adicionado

- Script first-party: `scripts/monitor-stability-evidence.mjs`
- Gate determinístico: `scripts/monitor-stability-gate.mjs`
- Comandos:
  - `npm run monitor:stability:evidence`
  - `npm run monitor:stability:evidence:write`
  - `npm run monitor:stability:gate`
  - `npm run monitor:stability:gate:strict`

Objetivo: gerar evidência repetível de estabilidade de monitor sem depender de sessão interativa.

## Resultado mais recente (isolated)

- `agentDir`: `.sandbox/pi-agent`
- `sessionFile`: `2026-04-20T19-14-46-701Z_...import-2026-04-21T00-52-12-237Z.jsonl`
- `sessionStats.userMessages`: `8`
- `classifyFailures.total`: `0`
- `sovereignDelta.mentions`: `0`

Report gravado em:

- `.pi/reports/monitor-stability-2026-04-21T03-18-29-886Z.json`

## Observações

- O parser foi endurecido para evitar falso-positivo em trechos de código/log bruto.
- Leitura de tail agora é **bounded por bytes reais** (sem carregar arquivo inteiro em memória).
- A evidência passou a incluir métricas básicas de sessão (`userMessages`, `assistantMessages`, `toolResults`).
- A convergência de observabilidade agora está centralizada em `monitor-observability.ts`, usada por:
  - `monitor-summary.ts`
  - `monitor-sovereign.ts`

## Resultado de gate

- `monitor:stability:gate`: **pass** (`stable=true`)
  - checks: `min-user-turns >= 3` ✅, `max-classify-failures <= 0` ✅
- `monitor:stability:gate:strict`: **fail esperado** (`stable=false`)
  - motivo: `require-sovereign-delta` (sem menção de `monitor-sovereign-delta` no tail analisado)

## Próximo passo recomendado

Rodar smoke curto (>=3 turns) com `monitor_sovereign_control` e fechar com `monitor_sovereign_delta` + `monitor:stability:evidence:write` para evidência comparável por sessão.
