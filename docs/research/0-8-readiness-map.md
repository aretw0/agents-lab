---
title: 0.8 Readiness Map
description: Readiness map for agents-lab and pi-stack 0.8.
---

# Mapa de readiness 0.8.0 — agents-lab / pi-stack

Última revisão: 2026-05-21
Status: mapa público de readiness
Escopo: `agents-lab`, `@aretw0/pi-stack`, GitHub Pages e CI

## Leitura executiva

O estado atual para 0.8.0 é:

1. **Base publicada:** CI e GitHub Pages estão verdes no commit `ba0d8a6c` em 2026-05-21.
2. **Base local:** desenvolvimento usa `pnpm`, devcontainer, `lab pi`, gates locais e `pi:dev` com capacidades frias por padrão.
3. **Base de produto:** `@aretw0/pi-stack` deve continuar `strict-curated` por default; capacidades caras ficam opt-in.
4. **Fronteira protegida:** publish npm, provider routing, remote/offload, GitHub Actions como executor e automação forte exigem intenção explícita do operador.

## Pronto

| Área | Estado | Evidência |
|---|---|---|
| CI local e GitHub Actions | verde | `pnpm run ci:local:parity`; workflow `CI` passou no commit `ba0d8a6c` |
| GitHub Pages | publicado | `pages-build-deployment` passou; fonte `main /docs` |
| README público | enxuto | README reduzido e alinhado ao perfil `strict-curated` |
| Licença | alinhada | `LICENSE` raiz e pacotes `@aretw0/*` usam MIT |
| Discurso público | auditado | `repo:discourse:audit` cobre README, guias, primitives, architecture e research promovido |
| Instalação padrão | conservadora | `npx @aretw0/pi-stack` instala perfil `strict-curated` |

## Preparado, mas ainda protegido

| Área | Por que importa | Próximo passo seguro |
|---|---|---|
| Publish npm | afeta usuários e provenance | release por changesets/tag semver; `Publish` só em condição de release |
| GitHub Actions como executor | muda fronteira local-first | manter report-only até existir task protegida explícita |
| Provider routing | pode gastar quota e trocar modelo real | canários bounded, rollback e decisão do operador |
| Monitor runtime amplo | pode adicionar ruído/custo | calibrar com evidência e regressões antes de ampliar default |
| Delegação/long-run | pode acelerar trabalho, mas aumenta superfície de falha | promover por packets report-only e gates de rollback |

## Parked para médio/longo prazo

| Item | Motivo de park |
|---|---|
| Influências externas adicionais (`hermes-agent`, `sandcastle`, `claude-mem`, colônias antigas) | úteis como inspiração, mas desviam da convergência 0.8 se retomadas antes da lane local-safe amadurecer |
| Remote/offload/GitHub Actions como executor | protegido; só depois de maturidade local e contrato de cancelamento/rollback claro |
| Publish/release 0.8.0 | só após release readiness, install/smoke e docs estarem consistentes |
| Ajustes agressivos de provider routing | dependem de canário, quota, rollback e decisão do operador |

## Próximas Fatias

| Fatia | Validação |
|---|---|
| Propagar baseline para `refarm` e `vault-seed` | comparar devcontainer, cache, `gh`, Pi, terminal e CI antes de editar |
| Revisar docs públicas restantes | `repo:discourse:audit`, links do site e remoção de snapshots stale |
| Preparar release readiness | `release:readiness:v0.8.0`, install/smoke e changelog |

## Critério de parada

Parar e pedir decisão quando:

- a fatia exigir mutação protegida;
- a evidência apontar conflito real de produto;
- a validação falhar e a correção não for local-safe óbvia;
- o próximo passo aumentaria autonomia operacional em vez de apenas preparar readiness report-only;
- a fila local-safe cair abaixo de 3 fatias com validação clara.

## Critérios mínimos para 0.8.0

- instala e opera com defaults curados;
- mantém board/handoff/rollback auditáveis;
- reduz ruído e custo de monitores;
- não surpreende o usuário com CI, providers, publish, remote ou automação forte;
- prepara delegação/long-run apenas com gates report-only e rollback definido;
- incorpora influências externas apenas como padrões pequenos e mensuráveis;
- funciona bem em contextos variados de usuário sem depender do laboratório.

## Regra Editorial

Este mapa deve conter apenas estado verificável e próximos passos acionáveis. Snapshots históricos, IDs de board antigos e falhas já resolvidas devem ficar em research não promovido ou no board, não na página pública.
