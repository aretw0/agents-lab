---
created: 2026-04-13
status: draft
---

# Colony Readiness Checklist — agents-lab

Checklist de prontidão para liberar colônias (multi-agentes) com baixo risco de alucinação operacional.

## Objetivo

Definir um gate explícito de quando podemos "soltar colônias" no repositório com segurança e previsibilidade.

## Fase A — Fundamentos de Guardrails

- [x] Consolidar guardrails first-party em **uma extensão única** (`guardrails-core`) com módulos internos:
  - [x] `readPathGuard`
  - [x] `webRoutingGuard`
  - [ ] interface para futuros guardas (`writeGuard`, `gitGuard`)
- [x] Definir ordem determinística de interceptação (router → blockers → observabilidade)
- [ ] Unificar configuração em `.pi/settings.json` (`extensions.guardrails.*`)
- [ ] Definir política de fallback explícita por capability

## Fase B — Observabilidade e Feedback de Tooling

- [ ] Emitir logs estruturados por decisão de guardrail (motivo, regra, tool bloqueada)
- [ ] Criar relatório de conformidade por rodada (taxa de bloqueio, taxa de fallback, taxa de CDP-path)
- [ ] Padronizar motivos de bloqueio para análise automática (códigos curtos)
- [ ] Garantir rastreabilidade de execução por task/run id

## Fase C — Regressão e Não-Alucinação Operacional

- [ ] Suite mínima de regressão por capability crítica:
  - [ ] web interativo sensível (Cloudflare-like)
  - [ ] leitura/escrita de paths sensíveis
  - [ ] operações git de risco
- [ ] Gate de CI para bloquear merge sem testes de guardrails
- [ ] Definir baseline de qualidade para colônias:
  - [ ] `fallback_rate` máximo por domínio
  - [ ] `success_rate` mínimo por taskset
  - [ ] zero comandos proibidos em cenários strict

## Fase D — Pilot de Colônia

- [ ] Pilot controlado com 2–3 agentes (planner/executor/verifier)
- [ ] Escopo inicial: tarefas repetíveis e de baixo impacto
- [ ] Critérios de rollback automático (latência, erro, violação de guardrail)
- [ ] Retro semanal com ajuste de regras

## Interoperabilidade de Monitores (davidorex × colony)

- [x] Evidência estática: ants do `@ifi/oh-pi-ant-colony` usam `ResourceLoader` mínimo (`getExtensions: []`, `getSkills: []`) e **não carregam monitores do davidorex dentro dos ants**.
- [ ] Validar impacto dos monitores do davidorex no processo principal durante execução de colônia (monitor ON vs OFF).
- [ ] Definir profile operacional para pilot: `monitors off` durante colônia ou coexistência controlada por métricas.
- [ ] Registrar decisão final de convivência entre monitor "soldier" da colônia e monitores gerais de sessão.

## Gate de Liberação (Go/No-Go)

Liberar colônias por padrão apenas quando:

- [ ] Guardrails consolidados + configuráveis por projeto
- [ ] Observabilidade cobrindo decisões e violações
- [ ] Regressão estável por 3 rodadas consecutivas
- [ ] Pilot com métricas dentro do baseline acordado

## Estado atual (resumo)

- ✅ Policy e evidência A/B em Web já existem
- ✅ Etapa A determinística de web routing já implementada
- ✅ Guardrails consolidados em `guardrails-core`
- ✅ Regressão estável iniciada (rodada 1/3 no taskset cloudflare-recheck)
- ⏳ Próximo foco: fechar estabilidade 3/3 e pilot de colônia com política de monitores definida
