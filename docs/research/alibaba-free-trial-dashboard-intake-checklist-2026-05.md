# Alibaba free-trial dashboard intake checklist — 2026-05

Status: operator intake / report-only  
Tarefa: `TASK-BUD-899`  
Relacionado: `TASK-BUD-897`, `TASK-BUD-898`, `TASK-BUD-849` protegido

Use este checklist para registrar fatos do dashboard Alibaba antes de qualquer API key, `/login`, provider registration, `routeModelRefs`, `providerBudgets`, monitor migration ou gasto pago.

## 1. Identificação da conta/trial

| Campo | Valor |
| --- | --- |
| Conta Alibaba criada? | sim |
| Produto principal | Model Studio / DashScope compatible-mode observado no dashboard `https://modelstudio.console.alibabacloud.com` |
| Região da conta | desconhecido |
| Região do endpoint pretendido | endpoint internacional `dashscope-intl.aliyuncs.com` validou smoke em sessão nova |
| Plano | free trial |
| Billing pago automático ativo? | sim / não / desconhecido |
| Precisa adicionar cartão para usar o trial? | sim / não / desconhecido |
| Observação do dashboard |  |

## 2. Créditos, expiração e limites

| Campo | Valor |
| --- | --- |
| Créditos/saldo do trial | qwen-plus Remaining 968,126 / Total 1,000,000 após smoke; cerca de 3% consumido |
| Moeda/unidade | quota por modelo no dashboard; qwen-plus parece token/quota unit de 1,000,000 |
| Data de expiração |  |
| Reset ou janela de quota | diário / semanal / mensal / trial único / desconhecido |
| Hard cap documentado |  |
| Warn threshold oficial |  |
| Risco de cobrança pós-trial | baixo / médio / alto / desconhecido |
| Onde conferir burn rate |  |

Critério: se cobrança pós-trial não for clara, manter candidate-only.

## 3. Produto/API e endpoint

| Campo | Valor |
| --- | --- |
| API escolhida | DashScope compatible-mode para LLM inicial |
| Base URL oficial | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` validado em sessão nova; `https://dashscope.aliyuncs.com/compatible-mode/v1` retornou 401 para esta chave/conta |
| OpenAI-compatible? | sim para smoke sintético via compatible-mode |
| Endpoint candidato | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| SDK obrigatório? | sim / não / desconhecido |
| Streaming suportado? | sim / não / desconhecido |
| Tool/function calling suportado? | sim / não / desconhecido |
| Usage retornado na resposta? | tokens / requests / custo / nenhum / desconhecido |

Hipótese inicial a verificar: `https://dashscope.aliyuncs.com/compatible-mode/v1` pode ser relevante para Qwen/DashScope, mas não aplicar sem confirmar na conta.

## 4. Modelos disponíveis no free trial

| Modelo | Contexto | Input | Thinking/reasoning | Tool calling | Preço/unidade | Trial incluso? | Notas |
| --- | --- | --- | --- | --- | --- | --- | --- |
| qwen-plus | pi exibiu cerca de 31.6k/304 como 25% no smoke, sugerindo janela operacional bem menor que o control-plane atual | text | não configurado | desconhecido | quota free trial: Remaining 968,126 / Total 1,000,000 após smoke | sim | smoke sintético respondeu; bom candidato inicial, mas não para long-context control-plane |
| qwen-turbo | configurado localmente para smoke futuro | text | não configurado | desconhecido | desconhecido | provavelmente sim, confirmar no dashboard | provável candidato barato/rápido para classificadores se qualidade passar |
| catálogo Alibaba | dashboard mostra cerca de 100 LLMs, 55 visual models, 17 multimodal, 36 speech, 5 embeddings com quotas/free-trial variadas | variado | variado | variado | variado | sim para muitos, confirmar por tier | não enumerar tudo agora; selecionar shortlist pragmática |

Classificação sugerida:

- monitor/classifier barato: começar por `qwen-turbo` ou outro Qwen barato/rápido após 10 casos sintéticos.
- local-safe implementation pequeno: `qwen-plus` para tarefas curtas/delegadas, sem contexto grande.
- review pesado: manter OpenAI Codex por enquanto; avaliar Qwen maior só após shortlist.
- não usar: Qwen como control-plane longo/auto-compact nesta fase, pois contexto subiu para ~25% em smoke e falhas de auth anteriores quebraram compactação.

## 5. Login/configuração

| Pergunta | Resposta |
| --- | --- |
| `/login` nativo no pi existe para esse provider? | sim / não / desconhecido |
| `/login qwen-cli` cobre esta conta/trial? | sim / não / desconhecido |
| Provider id desejado | alibaba / dashscope / qwen-cli / outro |
| Auth oficial | API key disponível pelo operador; OAuth/device-code ainda desconhecido |
| Refresh/expiração de token | API key; rotação/expiração ainda desconhecida |
| Onde o segredo ficaria | recomendado: variável de ambiente `DASHSCOPE_API_KEY`; nunca no repo |
| Logout/rollback claro? | remover/unset `DASHSCOPE_API_KEY` e remover provider de `models.json`; dashboard key revocation ainda a confirmar |
| Setup sem segredo no repo? | sim, se `models.json` referenciar apenas `DASHSCOPE_API_KEY` e não o valor da chave |

Gate: se não houver `/login` nativo, desenhar `/login` ou equivalente antes de uso recorrente.

## 6. Telemetry para quota visibility

| Sinal | Resposta |
| --- | --- |
| Provider/model aparecem nos logs pi? | sim: UI mostrou `dashscope/qwen-plus` e uso `31.6k/304` no smoke |
| Tokens input/output capturáveis? | sim na UI/pi para a chamada; dashboard também mostrou redução de quota qwen-plus |
| Custo capturável ou estimável? | sim / não / desconhecido |
| Requests capturáveis? | sim / não / desconhecido |
| Dashboard exporta usage? | sim / não / desconhecido |
| Erros 401/403/429 identificáveis? | sim: smoke `OK_ALIBABA_SMOKE` retornou 401 `Incorrect API key provided` no endpoint `dashscope.aliyuncs.com` |
| Burn rate do trial verificável após 1 chamada? | sim: qwen-plus ficou Remaining 968,126 / Total 1,000,000, cerca de 3% usado após smoke válido em sessão nova |

Sem telemetry mínima, manter apenas smoke manual e report-only.

## 7. Privacidade e escopo

| Pergunta | Resposta |
| --- | --- |
| Termos de retenção revisados? | sim / não / desconhecido |
| Pode receber prompts sintéticos? | sim / não / desconhecido |
| Pode receber trechos de conversa? | sim / não / desconhecido |
| Pode receber caminhos de arquivo? | sim / não / desconhecido |
| Pode receber snippets de código? | sim / não / desconhecido |
| Pode receber conteúdo protegido? | não por default / sim com decisão explícita |
| Região de processamento aceitável? | sim / não / desconhecido |

Default: privacidade desconhecida implica prompt sintético apenas.

## 8. Primeiro smoke permitido futuramente

Ainda não autorizado. Quando houver decisão protegida futura, o smoke mínimo deve ser:

- 1 chamada;
- prompt sintético sem código privado;
- cap explícito de custo/crédito;
- registrar antes/depois do saldo do trial;
- registrar provider/model/baseUrl/auth method usado;
- registrar usage retornado;
- parar imediatamente em erro de auth, custo desconhecido ou queda inesperada de crédito.

## 9. Decision gate

Só avançar de `candidate-only` para `canary-ready` quando estes itens estiverem preenchidos:

- [ ] produto/API definido;
- [x] endpoint/região operacional para smoke: `dashscope-intl.aliyuncs.com`; primeira tentativa em `dashscope.aliyuncs.com` falhou 401;
- [ ] modelos disponíveis e trial-inclusos priorizados em shortlist; dashboard lista muitos modelos, não enumerar todos antes de tiering;
- [ ] crédito, expiração e risco de cobrança entendidos;
- [ ] método de auth/login definido;
- [ ] `/login` nativo ou equivalente planejado;
- [ ] segredo fora do repo;
- [ ] telemetry mínima conhecida;
- [ ] privacidade/retention aceitável;
- [ ] rollback claro;
- [ ] decisão humana protegida para qualquer chamada real.
