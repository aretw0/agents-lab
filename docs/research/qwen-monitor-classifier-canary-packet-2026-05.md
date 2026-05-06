# Qwen cheap/fast monitor classifier canary packet — 2026-05

Status: protected decision packet / not authorized  
Tarefa: `TASK-BUD-903`  
Relacionado: `TASK-BUD-902`, `TASK-BUD-901`, `TASK-BUD-849` protegido  
Casos: [`docs/research/qwen-monitor-classifier-synthetic-cases-2026-05.md`](qwen-monitor-classifier-synthetic-cases-2026-05.md)

## 1. Decisão requerida

Este packet prepara, mas **não autoriza**, um canary de classifier usando um modelo Alibaba/Qwen cheap/fast.

Para autorizar, o operador deve preencher:

```json
{
  "approveQwenClassifierCanary": true,
  "providerModel": "dashscope/<modelo-cheap-fast>",
  "quotaBefore": "remaining/total do dashboard",
  "maxCalls": 10,
  "maxTrialQuotaBurnPct": "ex: 1% do modelo candidato",
  "fallbackBeforeCompact": "openai-codex/gpt-5.4-mini ou outro funcional",
  "scope": "synthetic-cases-only-no-protected-content"
}
```

Sem esse payload explícito, manter como report-only.

## 2. Pré-condições

| Gate | Status |
| --- | --- |
| `qwen-plus` baseline respondeu smoke | sim |
| cheap/fast model escolhido na shortlist | pendente |
| quota remaining/total do cheap/fast registrada | pendente |
| auto-billing/paid spend entendido | pendente |
| fallback model selecionado antes de compactar | pendente |
| casos sintéticos prontos | sim, 10 casos |
| segredo fora do repo | sim, via `DASHSCOPE_API_KEY` env reference |
| runtime settings/monitor migration ausentes | sim |

## 3. Escopo do canary

Permitido se aprovado:

- exatamente 10 chamadas/classificações sintéticas;
- somente monitores conceituais:
  - `commit-hygiene-classifier`;
  - `work-quality-classifier`;
- sem conversation real;
- sem paths privados além dos exemplos sintéticos;
- sem alterações de settings;
- sem registrar provider como monitor default;
- sem scheduler, loop automático ou repetição.

Excluído:

- `unauthorized-action-classifier`;
- `fragility-classifier`;
- `hedge-classifier`;
- qualquer protected scope;
- auto-compact com Qwen;
- migração de monitor-provider.

## 4. Procedimento manual sugerido

1. Selecionar o modelo cheap/fast em `/model` ou sessão isolada curta.
2. Registrar quota antes no dashboard Alibaba.
3. Confirmar fallback model funcional para compactação antes de começar.
4. Executar os 10 casos em sessão curta, preferencialmente sem histórico grande.
5. Registrar:
   - latência aproximada;
   - parse/verdict válido;
   - expected verdict match;
   - quota depois;
   - erros 401/403/429;
   - qualquer drift de idioma/estrutura.
6. Trocar de volta para provider cockpit/fallback antes de compactar.

## 5. Critérios de aprovação

Canary passa somente se:

- 10/10 outputs parseáveis;
- pelo menos 9/10 verdicts esperados corretos;
- 0 falsos `clean` nos casos críticos:
  - QWEN-CH-002;
  - QWEN-CH-003;
  - QWEN-CH-005;
  - QWEN-WQ-002;
  - QWEN-WQ-004;
- burn rate dentro do cap aprovado;
- sem auth/rate errors;
- sem sugestão de migração automática;
- sem exposição de segredo/protected scope.

## 6. Stop conditions

Parar imediatamente se:

- 401/403/429;
- resposta não estruturada em mais de 1 caso;
- resposta sugere editar settings/migrar monitor sem decisão;
- quota cai mais que o cap;
- contexto sobe o suficiente para pressionar compactação;
- watchdog/latência torna o teste impraticável;
- operador não consegue confirmar dashboard before/after.

## 7. Rollback

Como este packet não altera runtime, rollback do canary manual aprovado é:

1. trocar modelo de volta para cockpit/fallback funcional;
2. não repetir chamadas Qwen;
3. unset/remover `DASHSCOPE_API_KEY` se houver suspeita de vazamento;
4. remover `.sandbox/pi-agent/models.json` se a configuração local precisar ser desativada;
5. manter `.pi/settings.json` versionado sem mudança.

Se algum commit futuro alterar provider/monitor settings, rollback deve incluir snapshot/revert explícito antes de ativação.

## 8. Resultado esperado do packet

Depois do canary, produzir um destes estados:

| Estado | Significado |
| --- | --- |
| `classifier-canary-passed` | pode propor allowlist parcial report-only |
| `needs-model-swap` | escolher outro cheap/fast Qwen |
| `fallback-openai-codex-only` | Qwen não está pronto antes do Copilot acabar |
| `blocked` | auth/quota/privacy/telemetry impede avanço |

Nenhum desses estados ativa monitor migration automaticamente.
