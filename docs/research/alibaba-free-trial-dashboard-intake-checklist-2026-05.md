# Alibaba free-trial dashboard intake checklist — 2026-05

Status: operator intake / report-only  
Tarefa: `TASK-BUD-899`  
Relacionado: `TASK-BUD-897`, `TASK-BUD-898`, `TASK-BUD-849` protegido

Use este checklist para registrar fatos do dashboard Alibaba antes de qualquer API key, `/login`, provider registration, `routeModelRefs`, `providerBudgets`, monitor migration ou gasto pago.

## 1. Identificação da conta/trial

| Campo | Valor |
| --- | --- |
| Conta Alibaba criada? | sim / não |
| Produto principal | DashScope / Model Studio / Alibaba Cloud Model Service / outro / desconhecido |
| Região da conta |  |
| Região do endpoint pretendido |  |
| Plano | free trial / pay-as-you-go / outro |
| Billing pago automático ativo? | sim / não / desconhecido |
| Precisa adicionar cartão para usar o trial? | sim / não / desconhecido |
| Observação do dashboard |  |

## 2. Créditos, expiração e limites

| Campo | Valor |
| --- | --- |
| Créditos/saldo do trial |  |
| Moeda/unidade | USD / CNY / tokens / requests / outro |
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
| API escolhida |  |
| Base URL oficial | erro 401 observado em `https://dashscope.aliyuncs.com/compatible-mode/v1`; testar/confirmar endpoint internacional `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| OpenAI-compatible? | sim, hipótese operacional via compatible-mode; smoke ainda falhou em auth |
| Endpoint candidato | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` até confirmação no dashboard |
| SDK obrigatório? | sim / não / desconhecido |
| Streaming suportado? | sim / não / desconhecido |
| Tool/function calling suportado? | sim / não / desconhecido |
| Usage retornado na resposta? | tokens / requests / custo / nenhum / desconhecido |

Hipótese inicial a verificar: `https://dashscope.aliyuncs.com/compatible-mode/v1` pode ser relevante para Qwen/DashScope, mas não aplicar sem confirmar na conta.

## 4. Modelos disponíveis no free trial

| Modelo | Contexto | Input | Thinking/reasoning | Tool calling | Preço/unidade | Trial incluso? | Notas |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  | text / image | sim / não / desconhecido | sim / não / desconhecido |  | sim / não / desconhecido |  |

Classificação sugerida:

- monitor/classifier barato:
- local-safe implementation pequeno:
- review pesado:
- não usar:

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
| Provider/model aparecem nos logs pi? | sim / não / desconhecido |
| Tokens input/output capturáveis? | sim / não / desconhecido |
| Custo capturável ou estimável? | sim / não / desconhecido |
| Requests capturáveis? | sim / não / desconhecido |
| Dashboard exporta usage? | sim / não / desconhecido |
| Erros 401/403/429 identificáveis? | sim: smoke `OK_ALIBABA_SMOKE` retornou 401 `Incorrect API key provided` no endpoint `dashscope.aliyuncs.com` |
| Burn rate do trial verificável após 1 chamada? | não verificado; chamada falhou antes de uso válido |

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
- [ ] endpoint/região confirmado; primeira tentativa em `dashscope.aliyuncs.com` falhou 401, testar/confirmar `dashscope-intl.aliyuncs.com`;
- [ ] modelos disponíveis e trial-inclusos listados;
- [ ] crédito, expiração e risco de cobrança entendidos;
- [ ] método de auth/login definido;
- [ ] `/login` nativo ou equivalente planejado;
- [ ] segredo fora do repo;
- [ ] telemetry mínima conhecida;
- [ ] privacidade/retention aceitável;
- [ ] rollback claro;
- [ ] decisão humana protegida para qualquer chamada real.
