# Relatório de Canary Real — `agent_run_driver_step_dispatch`

**Tipo:** report-only (registro de validação)  
**Objetivo:** validar a primitiva agnóstica de dispatch de driver em subprocesso local real, sem ant_colony e sem provider/model real.

## Referência
- commit base: `5a28095f`
- commit anterior de integração da superfície agnóstica: `791aa4d4`

## Comando executado
- `node --version`
- `run_id`: `driver-step-local-node-version-real-canary`
- `cwd`: `/workspaces/agents-lab` (repo atual)
- `declared_files`: `["README.md"]`
- `log_path`: `.pi/reports/driver-step-local-node-version-real-canary.log`
- `timeout_ms`: `30000`
- parâmetros adicionais: `execute=true`, `operator_approval` estruturado, `follow=true`, `build_outcome=true`, `follow_max_wait_ms=5000`

## Resultado observado
- `mode`: `agent-run-driver-step-dispatch`
- `decision`: `dispatched`
- `dispatchAllowed`: `true`
- `processStartAllowed`: `true`
- `pid`: `32014`
- `final registry state`: `completed`
- `outputBytes`: `765`
- `agentRunOutcomePacket.contractDecision`: `pass`

## Log tail (resumo)
- `[agent-runner] starting command=node source=preview-command cwd=/workspaces/agents-lab`
- `[agent-runner] argv=["--version"]`
- `[agent-runner] preflight platform=linux node=v24.15.0 cwdExists=yes`
- `[agent-runner] preflight commandExists=path-lookup command=node`
- `[agent-runner] preflight entrypointExists=not-applicable`
- `[agent-runner] preflight argvShape print=no noSession=no provider=missing model=missing toolsCount=0 printPayloadCount=0`
- `[agent-runner] preflight attachments count=0 missing=0 firstMissing=none`
- `[agent-runner] preflight prompt segments=0 chars=0`
- `[agent-runner] first-byte stream=stdout elapsedMs=26 bytes=9`
- `v24.15.0`
- `[agent-runner] close exitCode=0 signal=none timedOut=no elapsedMs=28 childOutputBytes=9 stdoutBytes=9 stderrBytes=0 firstOutputElapsedMs=26`

## Validações de segurança solicitadas
- Sem fan-in: **confirmado**
- Sem `ant_colony`: **confirmado**
- Sem uso de provider/model real (somente subprocesso `node --version` local): **confirmado**

## Decisão
A camada operacional agnóstica da superfície `agent_run_driver_step_dispatch` foi validada para subprocesso local real com outcome embutido (`build_outcome=true`) em estado terminal.
