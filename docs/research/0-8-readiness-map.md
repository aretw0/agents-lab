---
title: 0.8 Readiness Map
description: Readiness map for agents-lab and pi-stack 0.8.
---

# Mapa de readiness 0.8.0 — agents-lab / pi-stack

Última revisão: 2026-06-10
Status: mapa público de readiness
Escopo: `agents-lab`, `@aretw0/pi-stack`, GitHub Pages e CI

## Leitura executiva

O estado atual para 0.8.0 é:

1. **Base publicada:** CI e GitHub Pages estão verdes em `main` na revisão desta página.
2. **Base local:** desenvolvimento usa `pnpm`, devcontainer, `lab pi`, gates locais e `pi:dev` com capacidades frias por padrão.
3. **Base de produto:** `@aretw0/pi-stack` deve continuar `strict-curated` por default; capacidades caras ficam opt-in.
4. **Fronteira protegida:** publish npm, provider routing, remote/offload, GitHub Actions como executor e automação forte exigem intenção explícita do operador.
5. **Release readiness:** `agent-run-driver-gate` está verde; `board-release-clear` ainda está bloqueado por tarefas em andamento no board, mas o relatório agora lista evidência candidata para as três influências externas P3. O bloqueio explícito para liberação ainda é deliberado: pacotes estão em `0.7.0`, então `target-version-ready` segue falso até decisão de release.
6. **Roadmap canônico:** direção macro fica em [ROADMAP.md]({{ site.repo_url }}/blob/main/ROADMAP.md); este arquivo registra readiness e evidência selecionada.

## Pronto

| Área | Estado | Evidência |
|---|---|---|
| CI local e GitHub Actions | verde | `pnpm run ci:local:parity`; workflow `CI` passa em `main` |
| GitHub Pages | publicado | `pages-build-deployment` passou; fonte `main /docs` |
| README público | enxuto | README reduzido e alinhado ao perfil `strict-curated` |
| Licença | alinhada | `LICENSE` raiz e pacotes `@aretw0/*` usam MIT |
| Discurso público | auditado | `repo:discourse:audit` cobre README, guias, primitives, architecture e research promovido |
| Instalação padrão | conservadora | `npx @aretw0/pi-stack` instala perfil `strict-curated` |
| Fronteira de engine | protegida | `engine:boundary:audit` mantém core portable e Pi em surfaces/adapters |
| Driver agent-run agnóstico | verde | `test:agent-run:drivers` cobre driver-step, pi-driver, payload emitido e cadeia arquivo-a-arquivo packet/result |
| Board de release | ainda com decisão pendente | `release:readiness:v0.8.0` reporta `board-release-clear` bloqueado por tarefas em execução, sem P0 aberto, e lista evidência candidata para `TASK-BUD-480`, `TASK-BUD-521` e `TASK-BUD-676`; o JSON versionado (`schemaVersion=1`) expõe `generatedAt`, `decision`, `versions`, `workflows`, `gates`, `checklist[*].kind`, `releaseBlockers`, `operatorDecisions` com `allowedActions`/alvos concretos, `nextActionCode`, `nextActions`, `automationPermissions`, `releaseDecisionReady`, `board.*Rows` e `board.evidenceCandidateRows` para agentes/automação local |

## Preparado, mas ainda protegido

| Área | Por que importa | Próximo passo seguro |
|---|---|---|
| Publish npm | afeta usuários e provenance | release por changesets/tag semver; `Publish` só em condição de release |
| GitHub Packages | muda registry, visibilidade e rota de consumo | manter `not-configured-opt-in` até decisão explícita e smoke dedicado |
| GitHub Actions como executor | muda fronteira local-first | manter report-only até existir task protegida explícita |
| Provider routing | pode gastar quota e trocar modelo real | canários bounded, rollback e decisão do operador |
| Monitor runtime amplo | pode adicionar ruído/custo | calibrar com evidência e regressões antes de ampliar default |
| Delegação/long-run | pode acelerar trabalho, mas aumenta superfície de falha | promover por packets report-only e gates de rollback |
| Versionamento 0.8.0 | transforma readiness em release real | bump/tag só após decisão explícita e revisão de release notes/changelog |

## Parked para médio/longo prazo

| Item | Motivo de park |
|---|---|
| Influências externas adicionais (`hermes-agent`, `sandcastle`, `claude-mem`) | agora têm canários local-safe versionados; a decisão restante é assimilação/park explícito, não pesquisa aberta automática |
| Colônias antigas | reconciliadas como telemetria histórica; não devem voltar como blockers sem candidate novo e evidência verificável |
| Remote/offload/GitHub Actions como executor | protegido; só depois de maturidade local e contrato de cancelamento/rollback claro |
| Publish/release 0.8.0 | só após decisão de versionamento, release notes/changelog e validação final |
| Ajustes agressivos de provider routing | dependem de canário, quota, rollback e decisão do operador |

## Próximas Fatias

| Fatia | Validação |
|---|---|
| Revisar release notes/changelog | confirmar mudanças desde `v0.7.0`, riscos e rollback antes de tag |
| Decidir candidatos de evidência do board | usar `operatorDecisions[*].candidateTaskIds`, `operatorDecisions[*].allowedActions` e `releaseDecisionReady` no JSON do readiness report para decidir se `TASK-BUD-480`, `TASK-BUD-521` e `TASK-BUD-676` ficam parked para 0.8 ou entram como trabalho requerido |
| Decidir bump 0.8.0 | `release:readiness -- --target 0.8.0` deve ficar verde exceto antes do bump; depois, verde completo |
| Revalidar instalação limpa | `release:package:smoke`, `docs:package:check`, install/smoke em ambiente limpo; GitHub Packages deve continuar opt-in se não aprovado |
| Manter acoplamentos de engine sob controle | `engine:boundary:audit`, sem dependências Pi em core portable |

## Critério de parada

Parar e pedir decisão quando:

- a fatia exigir mutação protegida;
- a evidência apontar conflito real de produto;
- a validação falhar e a correção não for local-safe óbvia;
- o próximo passo aumentaria autonomia operacional em vez de apenas preparar readiness report-only;
- a próxima ação for bump/tag/publish/release.

## Critérios mínimos para 0.8.0

- instala e opera com defaults curados;
- mantém board/handoff/rollback auditáveis;
- reduz ruído e custo de monitores;
- não surpreende o usuário com CI, providers, publish, remote ou automação forte;
- prepara delegação/long-run apenas com gates report-only e rollback definido;
- incorpora influências externas apenas como padrões pequenos e mensuráveis;
- mantém colônias antigas fora do caminho de release quando não há candidate verificável;
- funciona bem em contextos variados de usuário sem depender do laboratório.

## Regra Editorial

Este mapa deve conter apenas estado verificável e próximos passos acionáveis. Snapshots históricos, IDs de board antigos e falhas já resolvidas devem ficar em research não promovido ou no board, não na página pública.
