---
name: provider-model-discovery
description: >
  Descobre e seleciona modelos de providers LLM de forma report-only: inventário
  read-only de modelos, docs oficiais, quota/billing/rate gates e shortlist para
  canary protegido. Use antes de adicionar providers, escolher modelos ou migrar
  monitores/roteamento.
---

# Provider Model Discovery

Use esta skill quando precisar escolher modelos em um provider LLM com catálogo grande, especialmente antes de:

- adicionar um provider ao pi;
- escolher modelos para monitor/classifier;
- selecionar modelo barato/rápido, baseline, coder ou long-context;
- preparar canary protegido;
- transformar pesquisa ad hoc em runbook reproduzível.

## Postura de segurança

Esta skill é **report-only por padrão**.

Não faça sem aprovação explícita do operador:

- chamadas de prompt/completion;
- alteração de `.pi/settings.json`;
- alteração de `routeModelRefs`, `providerBudgets` ou default model/provider;
- migração de monitor-provider;
- criação/uso de API key;
- paid spend;
- scheduler/loop/retry automático;
- armazenamento de segredo em chat, docs ou repo.

Permitido por padrão:

- verificar se a env var existe **sem imprimir o valor**;
- consultar endpoints de listagem de modelos quando forem read-only;
- fazer busca/fetch de documentação pública;
- classificar ids por família;
- escrever docs/packets report-only;
- preparar decision packet que ainda exige aprovação do operador.

## Fluxo recomendado

### 1. Registrar escopo e provider

Defina no início:

| Campo | Exemplo |
| --- | --- |
| Provider | Alibaba DashScope |
| Env var esperada | `DASHSCOPE_API_KEY` |
| Região/base URL | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| Objetivo | cheap/fast classifier, coder/delegation, baseline |
| Protected boundary | sem settings/routing/monitor migration |

### 2. Verificar segredo sem vazar

Exemplo Node.js seguro:

```bash
node - <<'NODE'
const key = process.env.DASHSCOPE_API_KEY;
console.log(JSON.stringify({
  hasKey: Boolean(key),
  keyLength: key ? key.length : 0,
  note: 'key value intentionally not printed'
}));
NODE
```

Nunca imprimir prefixo/sufixo da key.

### 3. Listar modelos read-only

Para providers OpenAI-compatible, a rota típica é:

```text
GET <baseUrl>/models
Authorization: Bearer <env var value>
```

Para DashScope internacional:

```bash
node - <<'NODE'
const key = process.env.DASHSCOPE_API_KEY;
if (!key) {
  console.log(JSON.stringify({ ok: false, error: 'missing DASHSCOPE_API_KEY' }));
  process.exit(0);
}
const url = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models';
const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
const data = await res.json();
const models = Array.isArray(data?.data)
  ? data.data.map((model) => ({ id: model.id, object: model.object, owned_by: model.owned_by }))
  : [];
console.log(JSON.stringify({ url, status: res.status, ok: res.ok, count: models.length, models }, null, 2));
NODE
```

Não chamar `/chat/completions` ou equivalente nesta fase.

### 4. Classificar famílias de modelo

Agrupe por sinais no nome:

| Família | Sinais | Uso provável |
| --- | --- | --- |
| flash | `flash` | barato/rápido, classifier, prompts curtos |
| turbo | `turbo` | cost-floor, classificação/resumo simples, possível legado |
| plus | `plus` | baseline equilibrado |
| max | `max` | qualidade alta, análise complexa, não é fallback barato |
| coder | `coder` | código, review, delegação local-safe |
| long/context | `long`, `1m`, contexto alto | documentos longos, não usar sem medir custo |
| embedding/rerank | `embedding`, `rerank` | RAG/search; fora de classifier textual inicial |
| vl/omni/image/speech | `vl`, `omni`, `image`, `asr`, `tts` | multimodal; fora do canary textual inicial |

### 5. Buscar documentação oficial

Priorize documentação oficial antes de blogs/benchmarks:

1. model list / model catalog;
2. pricing / model invocation pricing;
3. free quota / trial / billing FAQ;
4. model usage / dashboard usage;
5. rate limits;
6. model-specific capability docs;
7. endpoint/region docs;
8. tool/function calling docs.

Para quick lookup local, use uma skill/ferramenta de web-search disponível. Exemplo fallback simples:

```bash
node node_modules/@ifi/oh-pi-skills/skills/web-search/search.js -n 10 "site:help.aliyun.com/zh/model-studio qwen model list pricing free quota rate limit"
```

Para fetch simples:

```bash
node node_modules/@ifi/oh-pi-skills/skills/web-fetch/fetch.js https://help.aliyun.com/zh/model-studio/models
```

Se houver `web_search`/`fetch_content` first-class no runtime, prefira essas tools para pesquisa profunda e páginas dinâmicas.

### 6. Extrair gates oficiais

Documente fatos com URL e incerteza:

| Gate | Pergunta |
| --- | --- |
| quota | Há remaining/total por modelo? Onde consultar? |
| free trial | O modelo tem free quota? Em qual região/edição? |
| stop automático | Existe free-quota stop? Qual erro retorna? |
| billing | O que acontece quando quota acaba? |
| usage delay | Dashboard atualiza em tempo real, minutos ou horas? |
| rate limit | Limite é por key, workspace, conta principal, modelo? |
| endpoint | O modelo funciona na região/base URL configurada? |
| tool calling | A família/modelo suporta tools? O custo dos tool descriptions conta? |
| context | Contexto máximo real e output máximo são conhecidos? |

### 7. Produzir shortlist pequena

Não enumere o catálogo inteiro. Escolha no máximo 3–5 papéis:

| Papel | Modelo | Por quê | Fallback |
| --- | --- | --- | --- |
| baseline | provider/model | já testado ou recomendado | alternativa equilibrada |
| cheap/fast | provider/model | custo/latência/classifier | cost-floor |
| coder | provider/model | código/delegação | quality-max ou coder-flash |
| long-context | provider/model | só se necessário | defer |
| embedding/rerank | provider/model | só se RAG for escopo | defer |

Cada linha deve ter fonte: API, doc oficial, dashboard ou benchmark externo.

### 8. Criar decision packet protegido

O packet deve exigir dados preenchidos pelo operador antes de execução:

```json
{
  "approveCanary": true,
  "providerModel": "provider/model-id",
  "quotaBefore": "remaining/total após refresh manual",
  "freeQuotaStop": "enabled | unavailable-with-reason",
  "maxCalls": 10,
  "executionMode": "serial-no-retry-no-loop",
  "maxTrialQuotaBurnPct": "valor conservador",
  "fallbackBeforeCompact": "modelo cockpit funcional",
  "inputScope": "synthetic-or-archived-no-protected-content",
  "stopOn": ["401", "403", "429", "quota exceeded", "rate limit", "unstructured output"]
}
```

Sem esse payload explícito, manter como report-only.

### 9. Validar documentação

Use validação local-safe:

```bash
pnpm vitest --run packages/pi-stack/test/smoke/provider-readiness.test.ts packages/pi-stack/test/smoke/quota-alerts.test.ts
```

Também valide marcadores nos docs gerados quando houver ferramenta disponível.

## Template de saída

```markdown
# Provider model discovery — <provider> — <date>

Status: report-only

## Summary
- Recommended cheap/fast:
- Recommended coder:
- Baseline:
- Blockers:

## Read-only API discovery
- endpoint:
- status:
- model count:
- exposed fields:
- missing fields:

## Official docs facts
| Topic | URL | Fact | Confidence |
| --- | --- | --- | --- |

## Shortlist
| Role | Candidate | Evidence | Fallback | Gate |
| --- | --- | --- | --- | --- |

## Protected canary packet
```json
{}
```

## Guardrails
- no prompt/completion calls
- no settings/routing changes
- no paid spend
- no secret exposure
```

## Promoção futura

Comece como skill. Promova para extensão/tool somente se houver necessidade recorrente de:

- normalizar APIs de vários providers;
- cachear inventários;
- gerar relatórios padronizados;
- integrar dashboard/quota com tool first-party;
- bloquear automaticamente rotas inseguras.

Enquanto isso, preserve o caminho manual e auditável.
