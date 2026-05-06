# Alibaba/Qwen free-trial strategy — 2026-05

Status: report-only / local-safe  
Tarefa: `TASK-BUD-900`  
Relacionado: `TASK-BUD-897`, `TASK-BUD-898`, `TASK-BUD-899`, `TASK-BUD-849` protegido

## 1. Evidência nova

O operador validou `dashscope/qwen-plus` em uma sessão nova.

Fatos reportados:

- o modelo apareceu no pi e conseguiu responder ao smoke sintético;
- endpoint operacional observado: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`;
- dashboard: `https://modelstudio.console.alibabacloud.com`;
- quota `qwen-plus`: Remaining `968,126` / Total `1,000,000` após o smoke;
- consumo observado: cerca de 3% da quota `qwen-plus`;
- catálogo free-trial grande: cerca de 100 LLMs, 55 visual models, 17 multimodal models, 36 speech models e 5 embedding models;
- trocar para `qwen-plus` em contexto de control-plane fez a UI mostrar cerca de 25% de contexto usado (`31.6k/304`), então Qwen não deve assumir long-context control-plane ainda.

Ruído ignorado: alertas locais de performance watchdog/event-loop/heap durante a sessão.

## 2. Leitura estratégica

Alibaba/Qwen passou de `candidate-only` para **smoke-proven candidate** para chamadas curtas.

Isso não autoriza ainda:

- trocar default provider/model;
- mover monitores automaticamente;
- alterar `routeModelRefs` ou `providerBudgets`;
- usar Qwen para auto-compact/control-plane longo;
- armazenar segredo em arquivo versionado;
- iniciar gastos pagos.

Mas autoriza planejamento report-only mais pragmático: usar free trial para descobrir quais modelos Qwen podem absorver trabalho simples/delegado antes que GitHub Copilot acabe.

## 3. Split desejado de responsabilidades

| Classe de trabalho | Provider preferido agora | Motivo |
| --- | --- | --- |
| Control-plane longo, handoff, compactação, decisões sensíveis | `openai-codex` | janela/contexto e confiabilidade ainda superiores |
| Smoke sintético e prompts curtos | `dashscope/qwen-plus` | já respondeu e dashboard mede quota |
| Monitores/classifiers baratos | Qwen barato/rápido a selecionar | Copilot pode ficar sem quota; OpenAI Codex deve ser preservado |
| Delegação local-safe pequena | `qwen-plus` ou Qwen coder após canary | bom uso de free trial sem comprometer control-plane |
| Review pesado/protegido | OpenAI Codex por enquanto | privacidade, qualidade e contexto ainda precisam de prova |

Regra prática: **OpenAI Codex segura o cockpit; Qwen carrega caixas pequenas conforme provar confiança.**

## 4. Não enumerar 100 modelos agora

O catálogo é grande demais para listar tudo manualmente sem custo cognitivo. A abordagem deve ser por tiers:

1. **Baseline curto**: `qwen-plus` — já funciona, medir qualidade/custo em prompts pequenos.
2. **Barato/rápido**: `qwen-turbo` ou equivalente — candidato inicial para monitores/classifiers.
3. **Coder/agentic**: modelos Qwen Coder disponíveis no trial — candidatos para delegação de fatias local-safe.
4. **Longer/context**: Qwen maior com contexto amplo — só se dashboard indicar quota suficiente e se smoke não explodir contexto.
5. **Embeddings/vision/multimodal**: backlog separado; não misturar antes de estabilizar LLM text.

Cada tier precisa de no máximo 1–2 modelos candidatos, não uma matriz de 100.

## 5. Canary ladder proposto

### Fase A — dashboard shortlist

Sem chamadas novas:

- selecionar 3 modelos LLM: baseline, cheap/fast, coder;
- registrar quota total/remanescente de cada um;
- registrar se cada modelo tem tool/function calling e streaming;
- registrar preço/unidade ou quota unit;
- manter `qwen-plus` como baseline já provado.

### Fase B — smoke sintético por tier

Uma chamada por modelo candidato:

- prompt sintético sem código privado;
- saída esperada curta;
- registrar antes/depois da quota;
- medir latência aproximada;
- parar se consumo for alto demais.

### Fase C — classifier mini-batch

Depois dos smokes:

- 10 casos sintéticos/arquivados;
- começar por `commit-hygiene` e `work-quality`;
- comparar estrutura/consistência com baseline atual;
- sem `unauthorized-action` no primeiro lote;
- sem monitor migration automática.

### Fase D — delegation mini-slice

Depois do classifier mini-batch:

- uma fatia local-safe pequena;
- escopo de arquivos declarado;
- validação focal conhecida;
- sem protected scope;
- Qwen como executor/delegado, não cockpit.

## 6. Critérios de confiança

Qwen pode assumir mais carga quando houver:

- 3 smokes de tier com auth estável;
- burn rate previsível no dashboard;
- pelo menos 10 classifier cases com output estruturado aceitável;
- nenhuma exposição de segredo/protected scope;
- latência aceitável;
- fallback claro para OpenAI Codex;
- registro de quota visibility ou lacuna documentada.

## 7. Riscos atuais

| Risco | Mitigação |
| --- | --- |
| Contexto aparente alto em `qwen-plus` | não usar como control-plane/compact; usar prompts curtos/delegados |
| Copilot pode acabar nos monitores | priorizar Qwen cheap/fast classifier canary |
| OpenAI Codex virar carga única | reservar OpenAI para cockpit/heavy/recovery |
| Catálogo Alibaba enorme | tiering, não inventário exaustivo |
| Quota free trial queima rápido | dashboard before/after em cada smoke |
| Endpoint/API key por região | manter `dashscope-intl` como operacional; documentar `dashscope.aliyuncs.com` 401 |

## 8. Próximo passo local-safe

Preencher shortlist manual de 3 LLMs no dashboard:

| Tier | Modelo candidato | Quota restante/total | Motivo |
| --- | --- | --- | --- |
| baseline | qwen-plus | 968,126 / 1,000,000 | smoke já passou |
| cheap/fast |  |  | monitor/classifier candidate |
| coder |  |  | delegação local-safe candidate |

Depois disso, preparar um packet protegido para **no máximo 2 chamadas sintéticas adicionais**: cheap/fast e coder.
