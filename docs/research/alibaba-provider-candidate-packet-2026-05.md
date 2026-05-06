# Alibaba provider candidate packet — 2026-05

Status: report-only / local-safe  
Tarefa: `TASK-BUD-897`  
Template: [`docs/primitives/provider-candidate-evaluation-template.md`](../primitives/provider-candidate-evaluation-template.md)  
Intake: [`docs/research/alibaba-free-trial-dashboard-intake-checklist-2026-05.md`](alibaba-free-trial-dashboard-intake-checklist-2026-05.md)  
Limite: sem API key, `.pi/settings.json`, `routeModelRefs`, `providerBudgets`, provider/model default, monitor override ou gasto pago.

## 1. Identidade do candidato

| Campo | Valor |
| --- | --- |
| Provider | Alibaba Cloud / DashScope / Qwen-compatible, a confirmar |
| Model ref proposto | desconhecido; não aplicar ainda |
| Papel pretendido | candidato barato/free-trial para monitores/classifiers e talvez fatias local-safe simples |
| Conta/plano | free trial recém-criado pelo operador |
| Fonte | relato do operador nesta sessão |

## 2. Fatos humanos/oficiais

| Campo | Valor |
| --- | --- |
| Conta criada | sim, Alibaba free trial |
| Objetivo do operador | colocar Alibaba como próximo provider na fila de assimilação |
| Estratégia de custo | aproveitar o máximo do free trial antes de pagar fornecedor novo |
| Política de pagamento | não gastar sem decisão futura explícita |
| Reset/expiração do trial | desconhecido |
| Créditos ou limites do trial | desconhecido |
| Região/endpoint | desconhecido |
| Evidência manual | relato do operador; dashboard ainda precisa ser registrado em packet/canary |

## 3. Política local atual

| Campo | Valor |
| --- | --- |
| Provider em `providerBudgets` | não |
| Provider em `routeModelRefs` | não |
| Provider em monitor-provider defaults | não |
| Estado local | candidate-only |
| Mudança permitida agora | nenhuma mudança runtime; docs/backlog apenas |

Regra: Alibaba só avança para canary depois de registrar unidade de custo, limites do free trial, endpoint/modelos, privacy terms, telemetry plan e rollback.

## 4. Hipótese de valor

Alibaba entra na fila porque pode ajudar a reduzir dependência de OpenAI/Copilot e oferecer modelos Qwen com custo baixo ou créditos de trial.

Hipóteses a validar:

- pode ser bom provider barato para monitor/classifier;
- pode preservar `openai-codex` para trabalho pesado;
- pode oferecer contexto/custo competitivo para fatias local-safe;
- pode ter API compatível o suficiente para integração futura;
- free trial permite medir qualidade/custo antes de pagar.

## 5. Unknowns bloqueantes

Antes de qualquer protected activation, responder:

1. Qual produto/API será usado: DashScope, Model Studio, OpenAI-compatible endpoint, outro?
2. Quais modelos estão disponíveis no free trial?
3. Qual model ref canônico seria usado no pi?
4. Qual unidade de cobrança: tokens, requests, crédito fixo, pacote por modelo?
5. Qual saldo/limite e expiração do free trial?
6. Existe cobrança automática depois do trial ou precisa ativar billing manualmente?
7. Quais regiões/endpoints e latência esperada do Brasil?
8. A API registra uso de forma que quota visibility consiga capturar provider/model/tokens/custo?
9. Há suporte confiável a tool/function calling ou structured output?
10. Quais termos de privacidade e retenção se aplicam a prompts/código?
11. Há risco de enviar conteúdo protegido para região/termos não aprovados?
12. Como rollback remove credenciais/configuração sem resíduo?
13. Existe login nativo no pi para Alibaba/Qwen/DashScope?
14. Se não existir, qual fluxo `/login` ou equivalente deve ser criado antes de ativação recorrente?

## 6. Login/configuração

Requirement assimilado: provider candidato sem login nativo no pi precisa de um caminho fácil via `/login <provider>` ou equivalente antes de virar rota recorrente, monitor provider ou default.

Para Alibaba, confirmar:

- se `/login qwen-cli` cobre a conta Alibaba free trial ou apenas `chat.qwen.ai`;
- se DashScope usa API key, OAuth/device-code ou outro mecanismo;
- se a configuração final deve ser `qwen-cli`, `alibaba`, `dashscope` ou outro provider id;
- se o segredo pode ficar em env/secret manager sem arquivo versionado;
- se há refresh/expiração automática ou rotação manual;
- qual rollback limpa credenciais e provider registration.

Caminho preferido: primeiro descobrir login/auth oficial e só depois propor packet protegido para `/login` nativo ou wrapper equivalente. `models.json` manual pode servir para smoke curto, mas não deve ser a experiência final de assimilação.

Referência local: [`docs/research/provider-login-surface-runway-2026-05.md`](provider-login-surface-runway-2026-05.md).

## 7. Telemetry desejada

| Sinal | Status atual | Necessário antes do canary |
| --- | --- | --- |
| Provider aparece nos JSONL | não | sim ou lacuna documentada |
| Tokens capturados | desconhecido | sim ou estimativa confiável |
| Custo capturado | desconhecido | idealmente sim |
| Requests capturados | desconhecido | necessário se trial for request-based |
| 429/auth/server errors | desconhecido | padrões capturáveis |
| Dashboard exportável | desconhecido | screenshot/manual note suficiente para início |
| Quota reset/expiração | desconhecido | obrigatório antes de gastar trial |

## 8. Canary proposto, ainda não autorizado

### Fase 0 — intake do dashboard

Docs-only:

- registrar saldo do free trial;
- registrar data de expiração;
- registrar modelos disponíveis;
- registrar pricing unit;
- registrar se billing pago automático está desativado;
- registrar endpoint/região.

### Fase 1 — smoke manual mínimo

Requer decisão protegida futura:

- uma chamada manual, sem código sensível;
- prompt sintético curto;
- confirmar auth, latência, modelo, usage e erro;
- registrar variação de saldo no dashboard.

### Fase 2 — classifier canary pequeno

Requer decisão protegida futura:

- 10 casos arquivados/sintéticos;
- somente `commit-hygiene-classifier` e `work-quality-classifier`;
- sem `unauthorized-action-classifier` no primeiro lote;
- cap explícito de chamadas e crédito;
- comparar output estruturado contra baseline.

### Fase 3 — advisory-only candidate

Somente depois de canary:

- proposta de `providerBudgets` report-only;
- proposta de `routeModelRefs` report-only;
- política de monitores allowlist/exclusion;
- rollback validado.

## 9. Stop conditions

Parar avaliação se:

- billing pago automático for inevitável antes do canary;
- free trial tiver unidade/cap obscuro;
- API não retornar usage suficiente e não houver dashboard claro;
- structured output falhar em casos simples;
- latência for ruim para monitor loop;
- privacidade/termos não permitirem conversation/tool-call snippets;
- qualquer configuração exigir armazenar segredo em repositório;
- custo do trial começar a consumir crédito rápido demais.

## 10. Postura relativa aos outros providers

| Provider | Postura frente ao Alibaba trial |
| --- | --- |
| GitHub Copilot | manter enquanto há quota; preparar saída |
| OpenAI Codex | preservar para trabalho pesado e fallback explícito; não queimar em monitores se Alibaba funcionar |
| Claude Code | avaliar oportunisticamente em separado; não substituir trial barato para monitores |
| Kimi/equivalente | permanece candidato paralelo; Alibaba entra como próximo da fila por já ter conta trial |

## 11. Decisão atual

Decision: candidate-only / backlog-priority.

Alibaba deve ser o próximo provider candidato a passar por intake de dashboard e canary design, antes de qualquer gasto pago ou mudança de runtime.

Próximo passo local-safe:

- preencher [`docs/research/alibaba-free-trial-dashboard-intake-checklist-2026-05.md`](alibaba-free-trial-dashboard-intake-checklist-2026-05.md) quando o operador trouxer saldo/modelos/expiração/login;
- depois preparar decision packet protegido para uma única chamada manual se fizer sentido.
