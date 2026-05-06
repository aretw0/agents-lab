# Qwen monitor-provider rollout e quota watch — 2026-05

Status: protected rollout executado localmente  
Tarefa: `TASK-BUD-849`  
Relacionado: `TASK-BUD-903`, `TASK-BUD-911`

## 1. Decisão aprovada

O operador aprovou a estratégia híbrida:

- Copilot sai do caminho crítico de classifier enquanto estiver em `429 quota exceeded`.
- Qwen/DashScope carrega volume barato/advisory.
- OpenAI Codex permanece como cockpit e fallback crítico.
- A prioridade é reduzir preocupação operacional com quota sem abrir gasto surpresa.

## 2. Canary Qwen

Execução protegida, sintética, serial, sem retry e sem conteúdo privado.

| Modelo | Resultado | Uso observado | Decisão |
| --- | --- | ---: | --- |
| `qwen3.6-flash` default thinking | 10/10 parseável, 10/10 verdict, 0 falso clean crítico | 10.980 tokens / ~77s | Qualidade ok, custo/latência ruins para monitor frequente. |
| `qwen-turbo` | parou em 2 casos por falso `clean` crítico no QWEN-CH-002 | 379 tokens / ~3s | Barato, mas inseguro para classifier de commit/provider scope. |
| `qwen3.6-flash` com `enable_thinking=false` | 10/10 parseável, 10/10 verdict, 0 falso clean crítico | 1.922 tokens / ~13s | Escolhido para volume advisory inicial. |

Critérios do packet atendidos para `qwen3.6-flash` sem thinking:

- 10/10 outputs parseáveis;
- 10/10 verdicts esperados;
- 0 falsos `clean` nos casos críticos;
- sem 401/403/429;
- sem migração automática irreversível;
- segredo permaneceu em `DASHSCOPE_API_KEY`, não foi registrado.

Observação: a execução do canary foi feita por script local direto em `.tmp`, então o uso detalhado do canary deve ser tratado como evidência manual; o painel `quotaVisibility` passa a observar chamadas futuras feitas pelo pi/runtime.

## 3. Configuração aplicada

### Local runtime/catalog

`.sandbox/pi-agent/models.json` foi atualizado localmente para incluir:

- provider `dashscope` com endpoint `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`;
- modelo `qwen3.6-flash`;
- `compat.thinkingFormat = "qwen"` para enviar `enable_thinking=false` quando `thinking: "off"`;
- segredo somente por referência `DASHSCOPE_API_KEY`.

### Classifier routing híbrido

| Monitor classifier | Provider/model | Motivo |
| --- | --- | --- |
| `commit-hygiene-classifier` | `dashscope/qwen3.6-flash` | advisory frequente; canary passou. |
| `work-quality-classifier` | `dashscope/qwen3.6-flash` | advisory frequente; canary passou. |
| `fragility-classifier` | `openai-codex/gpt-5.4-mini` | risco de falso positivo/diagnóstico; preservar qualidade. |
| `hedge-classifier` | `openai-codex/gpt-5.4-mini` | intenção/escopo pode ser ambíguo; preservar qualidade. |
| `unauthorized-action-classifier` | `openai-codex/gpt-5.4-mini` | crítico; não colocar em Qwen sem canary próprio. |

### Quota economy

`.pi/settings.json` agora mantém:

- `hedgeConversationHistory: false` por padrão;
- `classifierThinking: "off"`;
- `routeModelRefs.dashscope = "dashscope/qwen3.6-flash"`;
- budget local conservador para `dashscope`:
  - `monthlyQuotaTokens: 250000`;
  - `monthlyQuotaCostUsd: 0.01`;
  - `warnPct: 70`;
  - `hardPct: 90`.

Esse budget é **política local conservadora**, não leitura oficial do dashboard Alibaba.

## 4. Como acompanhar gasto da DashScope

### Checks locais no pi

Use estes sinais para o dia a dia:

```text
/quota-alerts
/qp snapshot
```

E, quando precisar de detalhe por provider:

```text
quota_visibility_provider_budgets(provider="dashscope", days=30)
provider_readiness_matrix(providers=["dashscope", "openai-codex"])
```

Estado observado logo após configurar o cap local:

- `dashscope`: `state=ok`;
- `observedTokens=31.874` em logs pi conhecidos;
- `periodTokensCap=250.000`;
- `usedPctTokens≈12,75%`;
- `projectedPctTokens≈65,87%`;
- `warnPct=70`, `hardPct=90`.

Interpretação: está seguro agora, mas perto o bastante do `warn` projetado para monitorar.

### Dashboard Alibaba/DashScope

O dashboard oficial continua sendo a fonte final para free quota e cobrança:

1. abrir `https://modelstudio.console.alibabacloud.com`;
2. ir em **Model Usage / Free quota** ou no card do modelo;
3. conferir `qwen3.6-flash` remaining/total;
4. ligar **Free quota exhausted stop**, se disponível;
5. se não estiver disponível, registrar motivo e reduzir cap local;
6. dar refresh manual antes/depois de canaries ou mudanças;
7. lembrar que uso pode atrasar alguns minutos e estatística detalhada pode atrasar até cerca de 1h.

Stop oficial esperado quando o free-quota stop está ativo:

```text
403 AllocationQuota.FreeTierOnly
```

## 5. Regra de troca de modelo

Quando `dashscope` chegar em `warn` local ou o dashboard mostrar free quota baixa:

1. reduzir primeiro chamadas/contexts de monitor;
2. manter `qwen3.6-flash` sem thinking enquanto estiver saudável;
3. não trocar para `qwen-turbo` para commit/work-quality sem novo prompt/canary, pois houve falso `clean` crítico;
4. testar outro candidato barato (`qwen-flash`, `qwen3-coder-flash` ou equivalente do dashboard) em 10 casos sintéticos antes de promover;
5. usar OpenAI Codex só como fallback crítico/temporário, não como volume default;
6. parar em 401/403/429 ou queda inesperada de quota.

## 6. Rollback

Rollback local seguro:

```bash
git checkout -- .pi/settings.json .pi/agents/*.agent.yaml packages/pi-stack/test/settings-shape-guard.test.mjs docs/research/qwen-monitor-provider-rollout-2026-05.md
```

Rollback de runtime local ignorado:

- remover `qwen3.6-flash` de `.sandbox/pi-agent/models.json` ou restaurar snapshot local;
- `unset DASHSCOPE_API_KEY` se houver qualquer suspeita de vazamento;
- voltar classifiers para `openai-codex/gpt-5.4-mini` ou provider anterior conhecido.

## 7. Estado final desta fatia

Estado recomendado depois do rollout:

```text
Copilot: fora dos classifiers enquanto quota-blocked/429.
Qwen/DashScope: volume advisory inicial, thinking off, budget local conservador.
OpenAI Codex: cockpit + monitores críticos + fallback.
Dashboard Alibaba: fonte final de free quota/cobrança.
```
