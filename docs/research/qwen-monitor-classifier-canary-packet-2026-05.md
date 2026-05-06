# Qwen cheap/fast monitor classifier canary packet — 2026-05

Status: protected canary executed with operator approval  
Tarefa: `TASK-BUD-903`  
Relacionado: `TASK-BUD-902`, `TASK-BUD-901`, `TASK-BUD-904`, `TASK-BUD-906`, `TASK-BUD-849` protegido  
Casos: [`docs/research/qwen-monitor-classifier-synthetic-cases-2026-05.md`](qwen-monitor-classifier-synthetic-cases-2026-05.md)

## 1. Decisão requerida

Este packet preparou o canary de classifier usando um modelo Alibaba/Qwen cheap/fast. Em 2026-05-06, o operador aprovou explicitamente a estratégia híbrida Qwen/OpenAI para sair do Copilot quota-blocked.

Payload de autorização equivalente:

```json
{
  "approveQwenClassifierCanary": true,
  "providerModel": "dashscope/qwen3.6-flash",
  "quotaBefore": "remaining/total do dashboard após refresh manual",
  "freeQuotaStop": "enabled | unavailable-with-reason",
  "maxCalls": 10,
  "executionMode": "serial-no-retry-no-loop",
  "maxTrialQuotaBurnPct": "ex: 1% do modelo candidato",
  "fallbackBeforeCompact": "openai-codex/gpt-5.4-mini ou outro funcional",
  "scope": "synthetic-cases-only-no-protected-content"
}
```

A execução permaneceu limitada a casos sintéticos, serial, sem retry/loop e sem alteração automática irreversível.

## 2. Pré-condições

| Gate | Status |
| --- | --- |
| `qwen-plus` baseline respondeu smoke | sim |
| cheap/fast model escolhido na shortlist | sim: `qwen3.6-flash` por descoberta API/docs |
| quota remaining/total do cheap/fast registrada | pendente no dashboard; cap local conservador configurado |
| `free quota exhausted stop` ligado ou indisponibilidade justificada | pendente no dashboard; stop manual em 403/429 mantido |
| auto-billing/paid spend entendido | parcial; docs oficiais alertam cobrança pay-as-you-go se quota acabar sem stop |
| fallback model selecionado antes de compactar | sim: OpenAI Codex cockpit/fallback |
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

1. Selecionar `dashscope/qwen3.6-flash` em `/model` ou sessão isolada curta; se o dashboard negar free trial/endpoint/cap, voltar para `qwen-turbo` ou `qwen-flash`.
2. Registrar quota antes no dashboard Alibaba após refresh manual.
3. Ligar `free quota exhausted stop` se o dashboard permitir; se não permitir, registrar motivo e reduzir cap manual.
4. Confirmar fallback model funcional para compactação antes de começar.
5. Executar os 10 casos em sessão curta, serial, sem retry automático e sem histórico grande.
6. Registrar:
   - latência aproximada;
   - parse/verdict válido;
   - expected verdict match;
   - quota depois;
   - erros 401/403/429;
   - qualquer drift de idioma/estrutura.
7. Trocar de volta para provider cockpit/fallback antes de compactar.

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
- `free quota exhausted stop` estava ligado ou a indisponibilidade foi justificada antes do teste;
- sem auth/rate errors;
- sem sugestão de migração automática;
- sem exposição de segredo/protected scope.

## 6. Stop conditions

Parar imediatamente se:

- 401/403/429;
- `403 AllocationQuota.FreeTierOnly`;
- `Allocated quota exceeded` ou `Request rate increased too quickly`;
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

## 8. Resultado do canary 2026-05-06

Resumo registrado em [`qwen-monitor-provider-rollout-2026-05.md`](qwen-monitor-provider-rollout-2026-05.md):

| Modelo | Resultado | Uso observado | Decisão |
| --- | --- | ---: | --- |
| `qwen3.6-flash` default thinking | 10/10 parseável, 10/10 verdict, 0 falso clean crítico | 10.980 tokens / ~77s | Qualidade ok, custo/latência ruins. |
| `qwen-turbo` | parou em 2 casos por falso `clean` crítico no QWEN-CH-002 | 379 tokens / ~3s | Barato, mas inseguro. |
| `qwen3.6-flash` com `enable_thinking=false` | 10/10 parseável, 10/10 verdict, 0 falso clean crítico | 1.922 tokens / ~13s | Aprovado para volume advisory inicial. |

Estado produzido: `classifier-canary-passed` para `commit-hygiene` e `work-quality` usando `qwen3.6-flash` com thinking off.

## 9. Estados possíveis do packet

Depois de futuros canaries, produzir um destes estados:

| Estado | Significado |
| --- | --- |
| `classifier-canary-passed` | pode propor allowlist parcial report-only |
| `needs-model-swap` | escolher outro cheap/fast Qwen |
| `fallback-openai-codex-only` | Qwen não está pronto antes do Copilot acabar |
| `blocked` | auth/quota/privacy/telemetry impede avanço |

Nenhum desses estados ativa monitor migration automaticamente.
