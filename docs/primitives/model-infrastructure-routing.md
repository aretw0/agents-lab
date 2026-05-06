# Model infrastructure routing

Status: primitive stub / report-only / protected boundary  
Fonte: `TASK-BUD-849`  
Relacionado: [`docs/research/model-infrastructure-interview-packet-2026-05.md`](../research/model-infrastructure-interview-packet-2026-05.md), [`docs/research/provider-assimilation-runway-2026-05.md`](../research/provider-assimilation-runway-2026-05.md), [`docs/research/alibaba-official-docs-qwen-selection-2026-05.md`](../research/alibaba-official-docs-qwen-selection-2026-05.md)

## 1. Objetivo

Definir o contrato conceitual para roteamento de modelos antes de qualquer implementação protegida.

Esta primitiva organiza:

- tiers de roteamento;
- evidência mínima por provider/modelo;
- gates de custo/quota/billing;
- política de privacidade/protected scope;
- canary e rollback;
- separação entre report-only, suggest-only e apply.

## 2. Não autorização

Este documento **não autoriza**:

- alteração de `.pi/settings.json`;
- alteração de `routeModelRefs`;
- alteração de `providerBudgets`;
- mudança de default provider/model;
- migração de monitores/classifiers;
- criação/armazenamento de API keys;
- paid spend;
- switch automático de provider/modelo;
- uso de provider novo em protected scope;
- scheduler/loop/offload/CI para execução de agentes.

Qualquer uma dessas ações continua pertencendo a `TASK-BUD-849` com decisão humana explícita.

## 3. Tiers conceituais

| Tier | Uso | Exemplo de evidência exigida |
| --- | --- | --- |
| `cheap-fast` | classificação simples, monitor canary, resumos curtos | custo/quota claros, output estruturado, latência aceitável |
| `balanced` | tarefas gerais local-safe e docs | qualidade suficiente, telemetria, fallback conhecido |
| `reliable-critical` | cockpit, recovery, review crítico | confiabilidade alta, contexto suficiente, operador aceita custo |
| `coder-delegation` | fatias pequenas de implementação/review de código | canary de código, tool/function support, rollback local |
| `long-context` | leitura extensa, compact/recovery | janela real conhecida, custo/cap explícito, fallback antes de compactar |
| `fallback-emergency` | manter trabalho quando provider primário falha | tempo limitado, cap explícito, dashboard conferido |

## 4. Evidence packet mínimo por modelo

Antes de promover qualquer modelo para um tier, registrar:

| Campo | Obrigatório |
| --- | --- |
| provider/model id | sim |
| endpoint/região | sim |
| auth/login surface | sim |
| quota remaining/total oficial | sim, se houver free quota |
| free-quota stop ou equivalente | sim, ou indisponibilidade justificada |
| preço/unidade ou incerteza explícita | sim |
| rate-limit behavior | sim |
| telemetry local | sim/no/unknown |
| structured-output canary | sim para monitores |
| privacy/data-retention review | sim antes de protected scope |
| rollback | sim |

## 5. Estados de maturidade

| Estado | Significado | Pode executar? |
| --- | --- | --- |
| `catalogued` | aparece em `/models` ou docs | não |
| `docs-backed` | docs oficiais indicam papel/capability | não |
| `dashboard-confirmed` | quota/cap/billing vistos pelo operador | ainda não |
| `synthetic-canary-approved` | operador aprovou packet bounded | só o canary |
| `synthetic-canary-passed` | canary curto passou critérios | propor allowlist report-only |
| `advisory-candidate` | pode ser recomendado por tooling | suggest-only |
| `activated` | settings/routing aplicados com rollback | só após `TASK-BUD-849` protegido |

## 6. Protected canary gate

Canary mínimo deve declarar:

```json
{
  "providerModel": "provider/model",
  "tier": "cheap-fast | coder-delegation | other",
  "quotaBefore": "remaining/total após refresh manual",
  "freeQuotaStop": "enabled | unavailable-with-reason",
  "maxCalls": 10,
  "executionMode": "serial-no-retry-no-loop",
  "fallbackBeforeCompact": "modelo cockpit funcional",
  "inputScope": "synthetic-or-archived-no-protected-content",
  "stopOn": ["401", "403", "429", "quota exceeded", "rate limit", "unstructured output"]
}
```

Sem esse packet, o estado máximo é `docs-backed` ou `dashboard-confirmed`.

## 7. Automação permitida por estado

| Estado | Automação permitida |
| --- | --- |
| `catalogued` | listar, classificar, documentar |
| `docs-backed` | sugerir shortlist, não executar |
| `dashboard-confirmed` | preparar packet protegido |
| `synthetic-canary-approved` | executar somente o canary aprovado |
| `synthetic-canary-passed` | gerar relatório/allowlist proposta |
| `advisory-candidate` | recomendar, sem aplicar |
| `activated` | aplicar somente dentro do escopo aprovado e rollback conhecido |

## 8. Rollback mínimo

Toda promoção além de report-only deve ter:

- snapshot de settings quando settings forem tocados;
- commit/revert path quando arquivos versionados mudarem;
- fallback model funcional antes de compact/reload;
- stop condition de auth/quota/rate/cost;
- evidência de como desativar provider/modelo;
- logs suficientes sem segredo.

## 9. Relação com Alibaba/Qwen

A trilha Alibaba/Qwen atual ilustra o fluxo:

1. `qwen-plus` ficou como baseline curto após smoke manual;
2. `qwen3.6-flash` está `docs-backed` para `cheap-fast`, mas ainda precisa dashboard/canary;
3. `qwen3-coder-next` está `docs-backed` para `coder-delegation`, mas ainda precisa dashboard/canary;
4. nenhum modelo Qwen está `activated` para monitores, routing, default ou protected scope.

## 10. Próximo passo seguro

Enquanto `TASK-BUD-849` estiver protected/parked, o trabalho permitido é:

- enriquecer packets report-only;
- coletar fatos de dashboard sem segredo;
- preparar canaries bounded;
- cultivar skills/runbooks;
- melhorar observabilidade local sem mudar provider/routing.
