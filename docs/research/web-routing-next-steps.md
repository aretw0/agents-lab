---
created: 2026-04-13
status: draft
---

# Web Routing — Próximos Passos Operacionais

Checklist vivo para não deixar backlog preso só na conversa.

## Concluídos

- [x] Policy de roteamento documentada em skills first-party (`source-research` e `web-browser`)
- [x] A/B inicial (`run-2026-04-13`) para avaliar hard enforcement global
- [x] Revalidação sem VPN focada em npmjs/Cloudflare (`run-2026-04-13-novpn-cf`)

## Em andamento

- [x] Implementada policy de **hard por escopo** nas skills first-party (`source-research`, `web-browser`):
  - trigger explícito: intent interativo + domínio sensível (ex.: `npmjs.com`) ou relato de Cloudflare
  - fallback explícito apenas após evidência de falha CDP
- [x] Implementada **Etapa A determinística** no runtime (`packages/pi-stack/extensions/web-routing-guard.ts`):
  - pre-router por heurística (intent interativo + domínio sensível/hint de Cloudflare)
  - bloqueio hard de comandos `bash` proibidos (`curl`, `wget`, `python requests`, `r.jina.ai`, `npm view`, `registry.npmjs.org`) em modo estrito
- [x] Teste de regressão dos cenários sensíveis (`packages/pi-stack/test/web-routing-guard.test.mjs`)
- [ ] Validar em run dedicado pós-policy (A/B + taskset cloudflare-recheck) para confirmar aderência operacional

## Próximos experimentos

- [ ] Repetir o taskset `cloudflare-recheck` por 3 rodadas para reduzir variância
- [ ] Criar taskset de autenticação/formulário (login real em ambiente de teste) para medir vantagem estrutural de CDP
- [ ] Medir custo incremental de setup browser (`start.js`) em sessão fria vs sessão quente

## Tarefas estruturais (antes da Etapa B)

- [ ] Consolidar `read-guard` + `web-routing-guard` em uma extensão única (`guardrails-core`)
- [ ] Definir esquema de config único em `.pi/settings.json` para todos os guardrails
- [ ] Padronizar códigos de bloqueio para facilitar telemetria/regressão

## Decisões pendentes de curadoria

- [ ] Decidir se `@ifi/oh-pi-skills/web-search` e `web-fetch` permanecem como fallback explícito
- [ ] Ou se entram em `FILTER_PATCHES` para reduzir ambiguidade da stack

## Critérios de saída desta trilha

- [ ] Documento de decisão final: quando usar soft policy, hard por escopo, ou hard global
- [ ] Pull request com mudanças de policy/installer + testes de regressão de roteamento
