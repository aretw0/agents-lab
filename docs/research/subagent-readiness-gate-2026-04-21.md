# Subagent readiness gate — execução 2026-04-21

## Mudanças implementadas

- Novo script: `scripts/subagent-readiness-gate.mjs`
- Novos scripts npm:
  - `subagent:readiness`
  - `subagent:readiness:strict`
  - `subagent:readiness:write`
- Novo guia operacional:
  - `docs/guides/subagent-readiness-gate.md`

## Resultado (baseline)

Comando:

```bash
npm run subagent:readiness
```

Resultado:

- `ready=true`
- `monitor.classifyFailures=0`
- `colonySignals.FAILED=0`
- `colonySignals.BUDGET_EXCEEDED=0`
- `colonySignals.COMPLETE=6` (janela: `--days 1 --limit 1`)

## Resultado (strict)

Comando:

```bash
npm run subagent:readiness:strict
```

Primeira execução (antes de ativar pilot):

- `ready=false`
- checks que falharam:
  - `pilot-package:@ifi/oh-pi-ant-colony` (missing)
  - `pilot-package:@ifi/pi-web-remote` (missing)

Ação aplicada:

```bash
npm run pi:pilot:on
npm run pi:pilot:status
```

Reexecução (após pilot on):

- `ready=true`
- packages presentes em `.sandbox/pi-agent/settings.json`:
  - `@davidorex/pi-project-workflows`
  - `@ifi/pi-web-remote`
  - `@ifi/oh-pi-ant-colony`

## Artefato de evidência

Comando:

```bash
npm run subagent:readiness:write
```

Reports:

- `.pi/reports/subagent-readiness-2026-04-21T03-38-30-921Z.json` (strict fail inicial)
- `.pi/reports/subagent-readiness-2026-04-21T03-42-54-525Z.json` (strict pass pós pilot)

## Interpretação pragmática

- A estabilidade base para delegação incremental está boa (baseline pass).
- O modo swarm strict ficou verde após `pi:pilot:on`.
- Próximo passo operacional: executar `/reload` na sessão interativa antes de delegar swarm real.
