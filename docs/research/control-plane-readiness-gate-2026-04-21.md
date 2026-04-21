# Control plane readiness gate — 2026-04-21

## Objetivo
Verificar se já podemos evoluir o control plane **usando superfícies estáveis existentes**, sem abrir frente grande de implementação nova.

## Evidência coletada (runtime)

1. `subagent_readiness_status(strict=true)`
   - `ready=false`
   - único bloqueio: `colony-min-complete-signals (0 vs >= 1)`
   - monitor turns/classify failures: OK
   - pacotes de pilot obrigatórios: OK

2. `context_watch_status`
   - `percent=21`
   - `level=ok`
   - thresholds ativos: warn/checkpoint/compact = `50/68/72`

3. `colony_pilot_preflight`
   - `ok=true`
   - sem capacidades/executáveis faltantes

4. `scheduler_governance_status`
   - policy: `observe`
   - lease owner ativo, heartbeat saudável, `foreignTaskCount=0`

5. `monitors_compact_status`
   - monitores: 5/5 enabled
   - classify failures: 0

6. `quota_alerts(24h)` + `provider_readiness_matrix`
   - alertas: nenhum
   - provider configurado: ready (`openai-codex/gpt-5.3-codex`)

7. `stack_sovereignty_status`
   - high risk: 0
   - medium risk: 2 (coexistência em scheduler/runtime guardrails com `@ifi/oh-pi-extensions`)

## Leitura objetiva (GO/NO-GO)

- **GO condicional para evolução de control plane em modo non-invasive.**
- O runtime base está estável o suficiente para avançar em **especificação + protocolo operacional + smoke de continuidade**.
- **Não GO** para automação agressiva de subagentes enquanto o gate estrito exige sinal `COMPLETE` recente (0/1 no recorte atual).

## Próximo passo recomendado (micro-slice)

1. Avançar `TASK-BUD-021` (control plane portátil) para `in-progress`.
2. Focar em artefatos de operação sobre o que já está estável:
   - protocolo de handoff/resume com lease ownership
   - checklist de retomada sem interromper background
   - smoke mínimo de continuidade (sem novos acoplamentos)
3. Rodar um ciclo controlado para obter evidência de `COMPLETE` recente e reavaliar `subagent_readiness_status(strict=true)`.

## Riscos residuais

- coexistência de capabilities (scheduler/guardrails) ainda pede consolidação gradual.
- gate estrito de subagentes depende de sinal operacional recente; sem isso, readiness continua formalmente bloqueado.
