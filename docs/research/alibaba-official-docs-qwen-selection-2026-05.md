# Alibaba official docs convergence for Qwen selection — 2026-05

Status: official-docs synthesis / local-safe  
Tarefa: `TASK-BUD-906`  
Relacionado: `TASK-BUD-904`, `TASK-BUD-905`, `TASK-BUD-849` protegido

## 1. Objetivo

Convergir a documentação oficial Alibaba/Aliyun com a nossa seleção de modelos Qwen e com o próximo packet protegido, sem executar prompts e sem mudar runtime.

Perguntas práticas:

1. A documentação oficial ajuda a escolher o modelo cheap/fast?
2. A documentação oficial confirma o modelo coder/delegation?
3. Há informação útil sobre free quota, cobrança e stop automático?
4. O que ainda precisa ser confirmado no dashboard antes de canary?

## 2. Fontes oficiais consultadas

| Tema | URL | O que foi útil |
| --- | --- | --- |
| Seleção/lista de modelos | `https://help.aliyun.com/zh/model-studio/models` | lista `qwen3.6-max-preview`, `qwen3.6-plus`, `qwen3.6-flash` como opções principais de texto, em ordem de capacidade/custo |
| Cursor com Alibaba Model Studio | `https://help.aliyun.com/zh/model-studio/cursor` | recomenda `qwen3.6-plus`, `qwen3.6-max-preview`, `qwen3-max`, `qwen3-coder-next`, `qwen3-coder-plus` para P&D/arquitetura; recomenda `qwen3-coder-next` e `qwen3.6-flash` para tarefas leves/auxiliares |
| Qwen-Coder | `https://help.aliyun.com/zh/model-studio/qwen-coder` | recomenda `qwen3-coder-next` como equilíbrio de qualidade, velocidade e custo; `qwen3-coder-plus` para qualidade máxima; documenta tool calling |
| Qwen Code | `https://help.aliyun.com/zh/model-studio/qwen-code` | confirma base URL `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, lista modelos de coding, e alerta consumo alto de tokens em ferramentas agentic |
| Free quota FAQ | `https://help.aliyun.com/zh/model-studio/new-free-quota` | explica validade, consulta de remaining quota, free-quota stop e cobrança pós-quota |
| Model usage | `https://help.aliyun.com/zh/model-studio/model-usage-statistics` | mostra como ver quota/uso, free-quota stop, delay de uso, e recomenda modelos leves como `qwen-turbo` para classificação/resumo simples |
| Rate limit | `https://help.aliyun.com/zh/model-studio/rate-limit` | limites são por main account somando RAM, spaces e API keys; 429 costuma recuperar em ~1 minuto; uso/monitor tem delay |

## 3. Fatos oficiais acionáveis

### 3.1 Modelo cheap/fast

Fatos:

- A página de modelos lista `qwen3.6-flash` como uma das opções principais de texto junto com `qwen3.6-max-preview` e `qwen3.6-plus`.
- A documentação de Cursor recomenda `qwen3.6-flash` para tarefas auxiliares/leves, junto com `qwen3-coder-next`.
- A documentação de uso recomenda, para classificação/resumo simples, escolher modelos leves de menor custo, citando `qwen-turbo` como exemplo.

Convergência:

1. manter `qwen3.6-flash` como **primeiro candidato modern/fast** para classifier canary;
2. manter `qwen-turbo` como **fallback cost-floor** se o dashboard mostrar que `qwen3.6-flash` não tem free quota/cap aceitável;
3. não usar `qwen-max`/`qwen3.6-max-preview` para monitor classifier barato.

### 3.2 Modelo coder/delegation

Fatos:

- A documentação Qwen-Coder diz que `qwen3-coder-next` é a recomendação principal por equilíbrio entre qualidade de código, velocidade e custo.
- A mesma documentação indica `qwen3-coder-plus` para tarefas de maior complexidade ou qualidade máxima.
- A documentação mostra uso via OpenAI-compatible Chat Completions e DashScope, incluindo base URL internacional quando aplicável.
- Qwen-Coder suporta tool/function calling; a documentação recomenda controlar quantidade de ferramentas porque descrições em `tools` contam como input tokens.

Convergência:

1. manter `qwen3-coder-next` como **primeiro candidato coder/delegation**;
2. usar `qwen3-coder-plus` só como qualidade máxima/protected heavier canary, não como default barato;
3. considerar `qwen3-coder-flash` como alternativa se o dashboard mostrar free quota/custo/latência melhor para fatias pequenas.

### 3.3 Free quota, cobrança e stop automático

Fatos oficiais:

- O FAQ de free quota diz que a quota nova costuma valer 30–90 dias; para novos usuários após 2025-09-08, 90 dias.
- A documentação também diz que free quota é para modelos da edição China Mainland; isto conflita parcialmente com nossa observação prática de quota visível no dashboard para `dashscope/qwen-plus` via conta/endpoint internacional.
- O dashboard/console é a fonte final para remaining quota por modelo.
- Free quota remaining pode ser visto em `Model Usage > Free quota` ou no model card no `Model Studio/Model Square`.
- `Free quota exhausted stop` evita cobrança extra: quando acaba, a chamada falha com `403 AllocationQuota.FreeTierOnly`.
- A função só pode ser ligada enquanto ainda existe quota não consumida; se não aparece, pode significar quota expirada, consumida, ou inexistente para aquele modelo.
- Sem free-quota stop, chamadas iniciadas podem continuar e tokens excedentes podem ser cobrados em pay-as-you-go.
- Dados de quota no console têm atualização em nível de minutos e podem exigir refresh manual.
- Registros de uso/monitoring podem demorar cerca de 1 hora.
- Se a conta estiver em欠费/arrears, outros modelos podem falhar mesmo tendo free quota.

Convergência:

Antes de qualquer canary Qwen, o packet protegido deve exigir:

- screenshot/leitura manual de remaining/total para `qwen3.6-flash`;
- se disponível, `free quota exhausted stop` ligado para esse modelo;
- se não disponível, motivo registrado e cap manual ainda menor;
- refresh manual do dashboard antes/depois;
- aceitar que uso detalhado pode só aparecer depois de alguns minutos/até 1 hora;
- stop condition específica para `403 AllocationQuota.FreeTierOnly`.

### 3.4 Rate limits

Fatos oficiais:

- Limit é por main account e soma RAM users, business spaces e API keys.
- Diferentes modelos têm limites independentes.
- Erros de rate/quota incluem `Requests rate limit exceeded`, `You exceeded your current requests list`, `Allocated quota exceeded`, `You exceeded your current quota` e `Request rate increased too quickly`.
- Além de RPM/TPM, pode haver RPS/TPS ou proteção por pico súbito.
- Recuperação de rate limit costuma acontecer em cerca de 1 minuto.

Convergência:

Para nosso canary de 10 casos:

- executar manualmente/serial, sem paralelismo;
- se houver 429/quota/rate error, parar;
- não repetir automaticamente;
- não usar scheduler/loop;
- registrar erro e voltar ao cockpit.

## 4. O que mudou na decisão

| Item | Antes | Depois da documentação oficial |
| --- | --- | --- |
| cheap/fast | `qwen3.6-flash`, por API/docs públicas | continua `qwen3.6-flash`, agora com respaldo oficial para tarefa leve; `qwen-turbo` vira fallback cost-floor oficial para classificação/resumo simples |
| coder | `qwen3-coder-next`, por Qwen-Coder doc | confirmado como recomendação principal oficial por equilíbrio qualidade/velocidade/custo |
| free quota | dashboard pendente | dashboard continua obrigatório; docs oficiais explicam stop automático, 403, delay, e risco de cobrança |
| billing risk | cap manual genérico | exigir checagem de `free quota exhausted stop` ou documentar indisponibilidade antes de canary |
| rate limit | stop em 429 genérico | canary deve ser serial e parar em rate/quota/ramp errors |
| future skill | ideia geral | skill/runbook deve capturar docs oficiais de free quota/stop/rate limits além de `/models` |

## 5. Checklist convergido para o próximo canary protegido

O canary de `dashscope/qwen3.6-flash` só deve ser executado se o operador confirmar:

```json
{
  "approveQwenClassifierCanary": true,
  "providerModel": "dashscope/qwen3.6-flash",
  "quotaBefore": "remaining/total do dashboard após refresh manual",
  "freeQuotaStop": "enabled | unavailable-with-reason",
  "maxCalls": 10,
  "executionMode": "serial-no-retry-no-loop",
  "maxTrialQuotaBurnPct": "definir valor conservador",
  "fallbackBeforeCompact": "modelo cockpit funcional",
  "stopOn": [
    "401",
    "403",
    "403 AllocationQuota.FreeTierOnly",
    "429",
    "Allocated quota exceeded",
    "Request rate increased too quickly",
    "unstructured output > 1 case"
  ]
}
```

Ainda não autoriza:

- migration de monitor-provider;
- alteração de settings/routeModelRefs/providerBudgets;
- uso de Qwen para compactação;
- chamada paralela;
- paid spend.

## 6. Como isso alimenta a futura skill/runbook

`provider-model-discovery` deve ter uma etapa oficial-docs obrigatória:

1. `/models` para inventário de IDs;
2. página oficial de modelos para famílias e nomes atuais;
3. página oficial de pricing/usage/free quota para cobrança e stop automático;
4. página oficial de rate limits para 429/TPM/RPM;
5. página oficial de model-specific capability para tool/function calling e recomendações;
6. síntese de `candidate`, `fallback`, `billingGate`, `rateGate`, `canaryGate`.

Padrão importante: a API de lista de modelos **não substitui** docs oficiais nem dashboard de quota.

## 7. Guardrails mantidos

Esta convergência não fez:

- prompt/completion call;
- smoke adicional;
- alteração de `.pi/settings.json`;
- alteração de provider/model default;
- alteração de monitor-provider defaults;
- alteração de `routeModelRefs` ou `providerBudgets`;
- gasto pago;
- registro de segredo.
