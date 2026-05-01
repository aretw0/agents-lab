# Escopo de calibração local-safe — background process + agents-as-tools (2026-05-01)

## Objetivo

Calibrar o substrato operacional sem abrir escopo protegido, usando waves bounded e primitivas report-only.

## Limites operacionais

- Wave size: 3-5 tasks
- Máximo 1 task `in-progress`
- Sem scheduler/remote/CI
- Sem start/stop automático fora de contrato explícito

## Waves propostas

### Wave 1 — foundation de calibração

- `TASK-BUD-500` — escopo e doutrina de calibração
- `TASK-BUD-501` — score de prontidão de background process
- `TASK-BUD-502` — score de calibração de agents-as-tools

### Wave 2 — documentação + baseline

- `TASK-BUD-503` — docs das primitivas
- `TASK-BUD-504` — baseline de leituras + checklist de próxima wave

## Gate de avanço entre waves

Avançar apenas se:

1. validação focal da wave atual estiver verde;
2. novas primitives permanecerem report-only;
3. checkpoint/handoff atualizado;
4. sem violação de local-safe/protected boundaries.

## Stop conditions

- falha focal repetida na mesma wave;
- tentativa de expandir para dispatch/start/stop sem decisão explícita;
- no-eligible para local-safe sem novo seed aprovado.

## Baseline inicial da calibração (report-only)

Leituras iniciais consolidadas nesta wave (via contrato determinístico e regressões):

- `background_process_readiness_score`
  - cenário mínimo (surfaces presentes, capabilities/evidência = 0): `score=20`, `code=background-process-readiness-needs-capabilities`
  - cenário calibrado (capabilities + evidência completas): `score=100`, `code=background-process-readiness-strong`
- `agents_as_tools_calibration_score`
  - cenário fraco (sem budget/checkpoint/packets): `code=agents-as-tools-calibration-needs-governance`
  - cenário calibrado (budget/checkpoint/dry-run/isolamento/observabilidade): `code=agents-as-tools-calibration-strong`

Nota operacional: invocação live das novas tools no runtime atual exige `/reload`; até lá, o baseline acima vale como referência de contrato testado localmente.

## Leitura live pós-reload (sessão atual)

Executado após `/reload` com as tools runtime já ativas:

- `background_process_readiness_score`
  - `score=20`
  - `code=background-process-readiness-needs-capabilities`
  - `dimensions`: `capabilities=0`, `surfaceWiring=100`, `operationalEvidence=0`
- `agents_as_tools_calibration_score`
  - `score=85`
  - `code=agents-as-tools-calibration-needs-governance`
  - `dimensions`: `governance=67`, `boundedness=100`, `observability=100`
- `ops_calibration_decision_packet` (`live_reload_completed=true`)
  - `decision=keep-report-only`
  - `code=ops-calibration-keep-report-only-background`
  - `blockers=background-readiness-not-strong`

Decisão consolidada: **manter report-only** e abrir nova wave local-safe para fechar gaps de capabilities/background e governança de agents-as-tools.

## Checklist da próxima wave operacional

- [x] rodar as duas tools novas após reload e registrar score real da sessão
- [x] manter decisão `report-only` se qualquer score ficar abaixo de 70
- [ ] só discutir promoção operacional quando ambos os scores ficarem >= 80
- [x] registrar checkpoint com decisão explícita (avançar/pausar)

## Runbook curto pós-reload (leitura live)

1. executar `/reload` para ativar as novas surfaces;
2. invocar `background_process_readiness_score` no modo padrão (inferência bounded quando `has_*` não for informado);
3. se necessário, repetir `background_process_readiness_score` com overrides explícitos (`has_*`) para contraste auditável;
4. invocar `agents_as_tools_calibration_score`;
5. invocar `ops_calibration_decision_packet` com `live_reload_completed=true`;
6. registrar checkpoint com scores, recommendationCode e decisão go/no-go para rehearsal local.

Critério go/no-go sugerido:

- **GO bounded rehearsal**: packet em `ready-for-bounded-rehearsal` e ambos os scores >= 80.
- **NO-GO (keep report-only)**: qualquer recommendationCode `keep-report-only-*`.

## Evidência mínima

- testes focais das mudanças
- marker-check dos anchors documentais
- checkpoint com decisão de avanço/pausa
