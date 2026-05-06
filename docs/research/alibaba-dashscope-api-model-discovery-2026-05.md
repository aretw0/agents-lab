# Alibaba/DashScope API model discovery — 2026-05

Status: research / local-safe  
Tarefa: `TASK-BUD-904`  
Relacionado: `TASK-BUD-901`, `TASK-BUD-903`, `TASK-BUD-849` protegido

## 1. Pergunta respondida

Sim: a mesma chave `DASHSCOPE_API_KEY` consegue consultar metadados básicos de modelos no endpoint OpenAI-compatible **da região correta**.

Teste read-only executado:

```text
GET https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models
Authorization: Bearer $DASHSCOPE_API_KEY
```

Resultado observado:

- status: `200`;
- total retornado: `154` modelos;
- campos úteis por modelo: `id`, `object`, `owned_by`;
- segredo não foi impresso nem registrado;
- nenhuma chamada de prompt/completion foi feita.

Controle regional:

```text
GET https://dashscope.aliyuncs.com/compatible-mode/v1/models
```

Resultado observado com a chave atual:

- status: `401`;
- erro: `invalid_api_key`;
- interpretação: a chave/conta atual funciona no endpoint internacional/Singapore (`dashscope-intl`) e não no endpoint China (`dashscope.aliyuncs.com`).

## 2. Limite do endpoint `/models`

O endpoint ajuda a listar ids, mas **não resolve sozinho** a escolha operacional.

Ele não expôs nesta consulta:

- quota remaining/total por modelo;
- preço;
- contexto máximo;
- suporte a tool/function calling;
- free-trial eligibility;
- auto-billing/paid-spend behavior;
- latência;
- qualidade em classifier/código.

Conclusão: usar `/models` para inventário inicial e filtragem por nome; usar dashboard/docs para quota/preço; usar canaries para qualidade/latência/estrutura.

## 3. Modelos relevantes encontrados por API

A API retornou muitos modelos multimodais, imagem, speech e embeddings. Para o nosso caso, os grupos úteis são:

| Grupo | Exemplos encontrados | Leitura operacional |
| --- | --- | --- |
| flash | `qwen3.6-flash`, `qwen3.5-flash`, `qwen-flash`, `qwen3-coder-flash` | candidatos baratos/rápidos; priorizar classifier e prompts curtos |
| plus | `qwen3.6-plus`, `qwen3.5-plus`, `qwen-plus`, `qwen3-coder-plus` | baseline equilibrado; bom para comparação e tarefas médias |
| max | `qwen3.6-max-preview`, `qwen3-max`, `qwen-max` | qualidade alta; não usar como fallback barato |
| coder | `qwen3-coder-next`, `qwen3-coder-plus`, `qwen3-coder-flash`, `qwen-coder-plus` | candidatos de delegação/código |
| turbo | `qwen-turbo`, `qwen-turbo-latest` | legado/baixo custo possível; avaliar só se dashboard/free trial favorecer |
| embedding | `text-embedding-v4`, `text-embedding-v3` | fora do escopo do monitor classifier agora |
| vl/omni/image/speech | vários | fora do escopo do canary textual inicial |

## 4. Rota de pesquisa usada

Correção de rota após feedback do operador: para busca web não-interativa, usei a skill local `@ifi/oh-pi-skills/web-search` (`node_modules/@ifi/oh-pi-skills/skills/web-search/search.js`) e `web-fetch` para extração simples de páginas, em vez de scraping manual ad hoc.

Isto confirma a recomendação já existente em `docs/research/web-overlap-scorecard.md`: quick lookup pode usar `oh-pi/web-search`; pesquisa profunda deve evoluir para `source-research` + `web_search`/`fetch_content` quando disponíveis.

## 5. Fontes oficiais consultadas

| Fonte | URL | Evidência útil |
| --- | --- | --- |
| Model invocation pricing | `https://www.alibabacloud.com/help/en/model-studio/model-pricing` | pricing existe por modelo/token, mas a página é parcialmente dinâmica; precisa dashboard/docs específicos para valores finais |
| DashScope API reference | `https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-dashscope` | documenta endpoints regionais, DashScope nativo, OpenAI-compatible SDK e tool calling/streaming |
| Qwen API reference CN | `https://help.aliyun.com/zh/model-studio/qwen-api-reference/` | compara interfaces: OpenAI Chat Completion, OpenAI Responses e DashScope; DashScope é a interface mais completa |
| Qwen-Coder capability CN | `https://help.aliyun.com/zh/model-studio/qwen-coder` | recomenda `qwen3-coder-next` como melhor equilíbrio para maioria dos cenários de código; `qwen3-coder-plus` para qualidade máxima; mostra tool calling |
| Qwen Code CN | `https://help.aliyun.com/zh/model-studio/qwen-code` | Qwen Code é otimizado para Qwen3-Coder; exemplos incluem `qwen3-coder-plus`, `qwen3-coder-next`, `qwen3.6-plus`; recomenda modelos fortes de código |

## 6. Fontes públicas/terceiras para orientação inicial

Estas fontes não substituem dashboard/canary, mas ajudam a criar norte:

| Fonte | URL | Sinal aproveitável |
| --- | --- | --- |
| AISCouncil Qwen provider guide | `https://doc.aiscouncil.com/providers/qwen/` | sugere Max para análise complexa, Coder/Coder Next para programação, Turbo para contexto enorme/custo baixo |
| Artificial Analysis Alibaba Cloud | `https://artificialanalysis.ai/providers/alibaba_cloud` | compara inteligência, performance e preço entre modelos Alibaba; útil para sanity check externo |
| TokenMix Qwen Plus/Turbo/Max | `https://tokenmix.ai/blog/qwen-plus-vs-turbo-vs-max-which-to-pick-2026` | leitura pública: Max = topo, Plus = equilíbrio, Flash = custo/velocidade; Turbo pode ser legado/menos atualizado |
| 16x Engineer Qwen3 Coder eval | `https://eval.16x.engineer/blog/qwen3-coder-evaluation-results` | referência externa para avaliar Qwen3 Coder em tarefas de programação |
| Qwen3-Coder GitHub | `https://github.com/QwenLM/Qwen3-Coder` | fonte do projeto: família Coder é voltada a coding/agentic tasks |

## 7. Recomendação pragmática inicial

Sem executar novos prompts, a seleção recomendada para preencher a shortlist é:

| Papel | Modelo recomendado | Por quê | Alternativa se dashboard negar quota/free trial |
| --- | --- | --- | --- |
| baseline curto | `qwen-plus` | já respondeu smoke; boa referência equilibrada | `qwen3.6-plus` se o dashboard indicar que substitui/beneficia mais |
| cheap/fast classifier | `qwen3.6-flash` | aparece no `/models`; naming indica geração nova + flash; fontes públicas tratam Flash como custo/velocidade | `qwen-flash` ou `qwen-turbo` se tiver quota maior/mais barata |
| coder/delegation | `qwen3-coder-next` | doc oficial Qwen-Coder recomenda como equilíbrio de código, velocidade e custo; suporta tool calling | `qwen3-coder-plus` para qualidade máxima; `qwen3-coder-flash` para custo/latência |

Regra de escolha final: se dashboard mostrar que `qwen3.6-flash` ou `qwen3-coder-next` não têm free trial/endpoint internacional/controle de gasto, escolher a alternativa mais próxima com quota visível e endpoint `dashscope-intl`.

## 8. Como essa descoberta deve virar runbook/skill no futuro

Candidato a skill futura: `provider-model-discovery` ou `dashscope-model-discovery`.

Fluxo reutilizável:

1. verificar se env var existe sem imprimir segredo;
2. consultar endpoint `/compatible-mode/v1/models` da região configurada;
3. classificar ids por família (`flash`, `plus`, `max`, `coder`, `turbo`, multimodal, embedding);
4. buscar docs oficiais de pricing/API/model selection;
5. buscar 2–4 fontes externas para baseline de mercado;
6. produzir shortlist de 3 modelos por papel;
7. bloquear execução até dashboard quota/cap/fallback serem preenchidos;
8. registrar que `/models` não prova quota, preço, latência ou qualidade.

## 9. Guardrails mantidos

Esta pesquisa não fez:

- chamada de prompt/completion;
- alteração de `.pi/settings.json`;
- alteração de `routeModelRefs`;
- alteração de `providerBudgets`;
- alteração de provider/model default;
- alteração de monitor-provider defaults;
- migração de classifier;
- gasto pago intencional;
- registro de API key em docs/logs.
