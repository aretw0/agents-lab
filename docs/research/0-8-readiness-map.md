---
title: 0.8 Readiness Map
description: Readiness map for agents-lab and pi-stack 0.8.
---

# Mapa de readiness 0.8.0 — agents-lab / pi-stack

Data: 2026-05-06  
Status: mapa operacional local-safe  
Lane: `0.8-local-safe-compounding-lane`  
Task: `TASK-BUD-918`

## Leitura executiva

A fase atual terminou uma sequência de abas abertas e voltou para a lane de poder controlado/auditado.

O estado recomendado para a 0.8.0 é:

1. **curto prazo:** consolidar estabilidade local-safe, clareza de board, handoff, docs e fila de fatias pequenas;
2. **médio prazo:** calibrar monitores/token economy e alinhar CI/CD quando houver aprovação protegida;
3. **longo prazo:** amadurecer model infrastructure, delegação e long-runs mais fortes somente depois de gates locais e report-only ficarem confiáveis.

## Pronto agora

| Área | Estado | Evidência |
|---|---|---|
| Provider economy inicial | pronto para uso conservador | `TASK-BUD-912` / `VERIFY-BUD-912`: Qwen/DashScope para classifiers advisory `commit-hygiene` e `work-quality`; OpenAI Codex preservado como cockpit/fallback crítico |
| Qwen classifier canary | pronto para modelo aprovado | `qwen3.6-flash` com thinking off passou; `qwen-turbo` rejeitado após falso `clean` crítico |
| Free quota guardrail operacional | pronto como evidência externa do operador | operador confirmou Alibaba `Free quota only`; quotas dashboard registradas |
| Reload/model catalog signal | pronto | `TASK-BUD-913` / `VERIFY-BUD-913`: context-watch detecta mudanças em `.pi/settings.json`, `.sandbox/pi-agent/settings.json`, `.sandbox/pi-agent/models.json`, `.pi/agents/*.agent.yaml|yml` |
| Lane local-safe 0.8.0 | pronta para execução | `TASK-BUD-917` documenta charter e boundaries |
| Backlogs de tangentes atuais | capturados | `TASK-BUD-914`, `TASK-BUD-915`, `TASK-BUD-916` |

## Preparado, mas ainda protegido

| Área | Por que importa | Próximo passo seguro |
|---|---|---|
| CI/CD e GitHub Actions | GitHub Actions está falhando e precisa coesão com gates locais | `TASK-BUD-914`: começar por coleta report-only de falhas e mapa local↔Actions; mutação de workflow exige aprovação explícita |
| Monitor stale feedback/token economy | feedback atrasado e classifiers podem gastar tokens demais | `TASK-BUD-915`: coletar exemplos com `docs/research/monitor-stale-feedback-intake-template-2026-05.md`, criar pre-filtro determinístico/cooldown e regressões antes de mexer em runtime amplo |
| Warning de monitor-provider overrides | reload mostra warning possivelmente legado: `overrides divergentes detectados (2)` | `TASK-BUD-916`: reproduzir e decidir downgrade/dedupe/removal; não rodar `/monitor-provider apply` sem aprovação |
| Model infrastructure ampla | independência de provider e roteamento por tarefa continuam valiosos | manter `TASK-BUD-849` como guarda-chuva protegido; avançar só por canários bounded |
| Delegação/long-run mais forte | pode acelerar limpeza/pesquisa de forma composta | `TASK-BUD-921`: sintetizar readiness report-only; sem auto-dispatch/scheduler/remote |

## Parked para médio/longo prazo

| Item | Motivo de park |
|---|---|
| Influências externas adicionais (`hermes-agent`, `sandcastle`, `claude-mem`, colônias antigas) | úteis como inspiração, mas desviam da convergência 0.8 se retomadas antes da lane local-safe amadurecer |
| Remote/offload/GitHub Actions como executor | protegido; só depois de maturidade local e contrato de cancelamento/rollback claro |
| Publish/release 0.8.0 | só após readiness, CI/CD, install/smoke e docs estarem consistentes |
| Ajustes agressivos de provider routing | dependem de canário, quota, rollback e decisão humana |

## Próxima fila recomendada — 3 a 7 fatias

| Ordem | Task | Tipo | Validação | Rollback |
|---:|---|---|---|---|
| 1 | `TASK-BUD-918` | readiness map | marker check + i18n lint + link no índice | reverter commit de docs/board |
| 2 | `TASK-BUD-919` | estoque de slices | board dependency/planning reports | reverter commit de board/handoff |
| 3 | `TASK-BUD-920` | higiene de board/foco | `board_planning_clarity_score` e `board_dependency_health_snapshot` | reverter commit de board |
| 4 | `TASK-BUD-921` | síntese delegation/long-run report-only | marker check + readiness packet tools | reverter commit de docs |
| 5 | `TASK-BUD-915` | monitor economy report-only | coletar evidência antes de runtime change | parar antes de mutação protegida |
| 6 | `TASK-BUD-914` | CI/CD report-only | coletar GitHub Actions failure evidence | parar antes de workflow mutation |
| 7 | `TASK-BUD-916` | startup warning/noise report-only | reproduzir warning sem apply | parar antes de `/monitor-provider apply` |

## Critério de avanço sem interação humana

Pode continuar automaticamente quando a próxima fatia:

- está na milestone `0.8-local-safe-compounding-lane`;
- é docs/board/test/report-only;
- tem validação focal conhecida;
- não toca CI/CD, provider/settings/routing, monitor override apply, publish/deploy, remote/offload ou limpeza destrutiva;
- pode ser revertida por um commit.

## Critério de parada

Parar e pedir decisão quando:

- a fatia exigir mutação protegida;
- a evidência apontar conflito real de produto;
- a validação falhar e a correção não for local-safe óbvia;
- o próximo passo aumentaria autonomia operacional em vez de apenas preparar readiness report-only;
- a fila local-safe cair abaixo de 3 fatias com validação clara.

## Definição pragmática de 0.8.0 incrível

Para esta jornada, “incrível” significa:

- instala e opera com defaults curados;
- mantém board/handoff/rollback auditáveis;
- reduz ruído e custo de monitores;
- não surpreende o usuário com CI, providers, publish, remote ou automação forte;
- prepara delegação/long-run com gates, não com fé;
- assimila influências externas como padrões pequenos e mensuráveis;
- funciona bem em contextos variados de usuário sem depender do laboratório.

## Higiene de planejamento da lane

Atualização local-safe (`TASK-BUD-920`): após auto-resume, os focos `TASK-BUD-925` e `TASK-BUD-931` foram concluídos e `TASK-BUD-849` continua protegido/defer por decisão de protected-focus packet. A continuação local-safe deve realinhar para fatias planejadas da lane, especialmente `TASK-BUD-926`, `TASK-BUD-928`, `TASK-BUD-929` e `TASK-BUD-930`, antes de sínteses mais amplas como `TASK-BUD-921`.

Tentativa dry-run de adicionar dependências explícitas em `TASK-BUD-921` foi bloqueada por protected-coupling herdado de `TASK-BUD-917`; a decisão segura é não forçar a mutação estrutural e manter o alinhamento documentado aqui.

## Auditoria de referências da lane

Atualização local-safe (`TASK-BUD-923`): a referência planejada a `docs/primitives/control-plane-overnight-local-loop.md` foi corrigida porque o arquivo não existe no repositório atual. A task `TASK-BUD-921` agora aponta para o pacote existente `docs/research/control-plane-long-run-maturity-packet-2026-05-01.md` e para `docs/primitives/nudge-free-local-continuity.md`, mantendo `docs/research/0-8-delegation-long-run-runway.md` como artefato futuro da própria task.

Arquivos futuros declarados em `TASK-BUD-924..931` permanecem intencionalmente ausentes até execução das respectivas fatias.

## Resumo para resume

Foco atual: seguir a fila stocked após `TASK-BUD-919`. A prioridade é executar fatias local-safe validadas para permitir evolução contínua com baixa iteração humana, mantendo CI/CD, monitor runtime amplo, provider routing, publish/deploy e remote/offload como escopos protegidos.
