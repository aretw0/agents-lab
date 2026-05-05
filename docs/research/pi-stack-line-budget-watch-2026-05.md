# Line-budget watch da pi-stack — 2026-05

Status: inventário local-safe  
Escopo: `packages/pi-stack/extensions/*.ts`  
Regra: este documento não executa extração; ele apenas prioriza fatias pequenas com validação focal e rollback.

## Resumo

O snapshot atual recomenda `watch`, não `extract` nem `critical`:

- Arquivos escaneados: 186.
- Acima de `watch` (1000 linhas): 3.
- Acima de `extract` (1400 linhas): 0.
- Acima de `critical` (2000 linhas): 0.
- Surfaces ainda com `JSON.stringify(result, null, 2)` em `content`: 17.

Interpretação: a base está saudável o suficiente para continuar limpando em fatias pequenas. O risco principal não é tamanho crítico imediato; é deixar surfaces de output, helpers e arquivos próximos de 1000 crescerem sem fronteiras explícitas.

## Alvos acima de 1000 linhas

| Arquivo | Linhas | Classe | Próximo passo local-safe | Validação focal | Rollback |
| --- | ---: | --- | --- | --- | --- |
| `packages/pi-stack/extensions/guardrails-core.ts` | 1395 | watch-alto | Auditar export/registration surface; evitar nova lógica neste arquivo; mover apenas wiring coeso se houver teste existente. | smoke de manifest/registration relacionado ao módulo alterado | Reverter extração/wiring do commit da fatia |
| `packages/pi-stack/extensions/guardrails-core-autonomy-lane-surface-helpers.ts` | 1193 | watch | Inventariar helpers por família antes de extrair; preferir doc/typing primeiro. | smoke de autonomy lane surface | Reverter helper extraído e imports |
| `packages/pi-stack/extensions/monitor-provider-patch.ts` | 1027 | watch | Congelar crescimento; se tocar novamente, extrair parser/normalizer puro com teste. | `monitor-provider-patch` smoke/regression | Reverter parser extraído |

## Próximos arquivos próximos do limite

| Arquivo | Linhas | Classe | Política |
| --- | ---: | --- | --- |
| `packages/pi-stack/extensions/context-watchdog.ts` | 998 | pre-watch | Não adicionar lógica nova sem extração prévia. |
| `packages/pi-stack/extensions/quota-visibility-model.ts` | 977 | pre-watch | Preferir helpers de cálculo separados. |
| `packages/pi-stack/extensions/guardrails-core-lane-queue.ts` | 962 | pre-watch | Manter mutations isoladas e cobertas por smoke. |
| `packages/pi-stack/extensions/guardrails-core-unattended-continuation.ts` | 948 | pre-watch | Evitar misturar policy, formatting e gate. |
| `packages/pi-stack/extensions/quota-visibility.ts` | 929 | pre-watch | Separar output/reporting de cálculo se crescer. |
| `packages/pi-stack/extensions/guardrails-core-autonomy-task-selector.ts` | 893 | pre-watch | Preservar seleção determinística; extrair ranking somente com fixture. |
| `packages/pi-stack/extensions/colony-pilot.ts` | 887 | pre-watch | Não expandir colônia antes de readiness/model-infrastructure. |

## Fatias recomendadas

1. **Output cohesion primeiro**: reduzir as 17 occurrences restantes de JSON cru em `content`, uma surface por task, com teste focal.
2. **Guardrails core surface inventory**: mapear registrations/exports de `guardrails-core.ts` antes de mover qualquer código.
3. **Autonomy helpers inventory**: agrupar helpers em famílias (`selection`, `batch`, `protected`, `material`, `telemetry`) antes de extração.
4. **Monitor provider patch extraction prep**: identificar função pura de normalização com menor acoplamento e criar teste de snapshot mínimo.
5. **Pre-watch guard**: ao tocar arquivos entre 900 e 1000 linhas, exigir nota de line-budget no board ou extração no mesmo slice.

## Não-objetivos

- Não fazer extração ampla no mesmo commit deste inventário.
- Não reescrever API pública de `context-watchdog`.
- Não alterar behavior runtime sem smoke focal.
- Não abrir protected scope, CI ou release.

## Critério de retorno à arquitetura maior

Podemos voltar a evolução arquitetural forte quando:

- outputs operator-visible principais estiverem summary-first;
- o board tiver packs locais/protegidos separados;
- arquivos `watch` tiverem política explícita de não crescer sem extração;
- agents-as-tools/delegação tiverem readiness barato e legível;
- `TASK-BUD-849` estiver pronto para foco humano por envolver provider/custo/API.
