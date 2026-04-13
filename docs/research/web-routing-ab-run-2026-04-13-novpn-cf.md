---
created: 2026-04-13
status: draft
---

# Web Routing A/B — Run 2026-04-13 (no-VPN, Cloudflare recheck)

## Contexto

Este run revalida os cenários que tinham risco de Cloudflare (npmjs) após desligar VPN.

- Protocolo base: `docs/research/web-routing-ab-protocol.md`
- Taskset: `cloudflare-recheck`
- Dataset: `docs/research/data/web-routing-ab/run-2026-04-13-novpn-cf/results.json`
- Restrição explícita dos prompts: **não usar `npm view` nem `registry.npmjs.org`**

## Métricas agregadas

| Braço | Success rate | Tempo médio (s) | CDP-path rate | Fallback rate | Disallowed command rate |
|---|---:|---:|---:|---:|---:|
| A (baseline) | 1.00 | 161.09 | 0.50 | 0.50 | 0.00 |
| B (policy-strict) | 1.00 | 73.34 | 1.00 | 0.00 | 0.00 |

## Evidência principal

1. Sem VPN, os cenários npmjs puderam ser concluídos com dados da interface web.
2. No taskset de Cloudflare recheck, `policy-strict` foi melhor que baseline em:
   - determinismo (CDP 100% vs 50%),
   - fallback (0% vs 50%),
   - latência média (73s vs 161s).
3. Não houve uso de comandos proibidos (`npm view`, `registry.npmjs.org`).

## Decisão de sobriedade (escopo)

- **Não muda** a decisão global anterior (sem hard enforcement global).
- **Habilita decisão local mais forte:** para intents interativas em npmjs/ambientes sensíveis a bloqueio, `web-browser first` é o comportamento recomendado.

Em resumo:
- Global: soft policy.
- Escopo npmjs/Cloudflare-sensitive: policy-strict preferencial.
