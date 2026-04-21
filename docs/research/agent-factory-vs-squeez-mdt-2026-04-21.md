# Agent factory × squeez × mdt (snapshot)

**Date:** 2026-04-21  
**Goal:** identificar o que absorver com pragmatismo na fábrica de agentes sem lock-in.

## Escopo e evidência

Repositórios analisados (cache local):
- `claudioemmanuel/squeez` @ `8e67d7a`
- `ifiokjr/mdt` @ `7c4aab9`

Referências internas usadas para baseline da fábrica:
- `docs/guides/agent-driver-charter.md`
- `docs/guides/session-triage.md`

## Baseline atual da fábrica (já forte)

1. `.project` como clock canônico + governança HITL (`no-auto-close`, evidência).
2. Operação em micro-lotes com checkpoint de contexto.
3. Watchdog advisory/non-blocking e presets de bootstrap por papel.
4. Trilha explícita para provider-agnostic e adapters de eventos/conversas.

## O que absorver de `squeez` (sem copiar arquitetura host-bound)

Valor prático:
- **compressão/normalização agressiva de saída** para reduzir custo de contexto.
- **modos adaptativos por pressão de contexto** (intensidade varia com budget).
- **memória de sessão resumida** orientada a continuidade.

Aplicação recomendada na fábrica:
- manter isso como **policy/primitive first-party** (extensão + tool), não acoplado a hooks específicos de um CLI host.
- preservar princípio local: **advisory-first**, bloqueio apenas em casos inequívocos.

## O que absorver de `mdt` (alto impacto rápido)

Valor prático:
- **single-source docs** com blocos reutilizáveis (`update/check`) e detecção de drift em CI.
- boa aderência para manter guias/políticas/prompts sincronizados sem retrabalho manual.

Aplicação recomendada na fábrica:
- usar `mdt` como **adapter opcional de documentação** para superfícies repetidas (README, guias, skills).
- começar em modo non-invasive: `check` em CI + 1-2 templates de prova de valor.

## Lacuna principal observada

Ainda falta uma **primitiva de captura de ideias** (inbox) para transformar notas soltas em backlog canônico com validação humana, sem exigir que toda ideia já nasça como task formal.

## Proposta objetiva (próximos micro-slices)

1. **Idea Inbox Primitive (P1)**
   - entrada: notas markdown/obsidian + ideias livres em sessão.
   - saída: candidatos em `.project/tasks` (`planned`, AC mínimo, links de origem).
   - gate: sem auto-close, revisão humana para promoção de prioridade.

2. **Doc Drift Guard com mdt (P2)**
   - piloto em 1-2 blocos compartilhados.
   - `mdt check` no verify (advisory no início).

3. **Output Shaping inspirado em squeez (P2)**
   - aplicar em superfícies first-party de alto ruído.
   - política por threshold/cooldown para evitar spam de notify.

## Decisão operacional deste snapshot

- Avançar primeiro no **Idea Inbox Primitive** (ganho de fluxo imediato para sessões com alta carga de ideias).
- Tratar `mdt` como habilitador de consistência documental em segundo passo.
- Manter qualquer inspiração de `squeez` no plano de primitivas first-party, sem lock-in de host.
