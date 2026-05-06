# Pi-stack architecture runway — 2026-05

Status: síntese local-safe  
Escopo: bridge entre cleanup/UI cohesion e evolução arquitetural forte  
Regra: este documento não implementa provider/model/cost/API, não mexe em settings e não altera execução protegida.

## Resposta operacional

Não estamos sem trabalho. A fila de side quests local-safe imediatas tinha acabado, mas isso era um bom sinal: as pendências restantes de output cru ficaram concentradas em superfícies protegidas. O próximo passo correto não é improvisar implementação grande; é abrir uma **runway arquitetural** com auditorias curtas, extrações testadas e decisões protegidas separadas.

Entrevista humana só é necessária para decisões de produto/custo/API/provedor. Para limpeza, alinhamento, decomposição, inventário de linhas, testes e extrações coesas, dá para seguir por semanas sem bloquear em perguntas.

## Evidência atual

| Sinal | Valor | Leitura |
| --- | ---: | --- |
| `board_dependency_hygiene_score` | 100 | Dependências estão fortes; o problema não é acoplamento explícito no board. |
| `board_planning_clarity_score` | 63 | Ainda precisa decomposição; há macro/protected items demais para retomar arquitetura pesada sem runway. |
| `line_budget_snapshot` | `watch` | Não há crise crítica, mas há 3 arquivos acima de 1000 linhas e vários próximos. |
| Git antes da runway | clean | Base segura para fatias pequenas. |
| Output raw JSON restante | protected leftovers | Restam `claude_code_execute`, `handoff_advisor`, `safe_boot`; todos precisam foco protegido. |

## Top line-budget watch

| Arquivo | Linhas aprox. | Classe | Decisão |
| --- | ---: | --- | --- |
| `packages/pi-stack/extensions/guardrails-core.ts` | 1396 | local-safe audit primeiro | Inventariar registrations/orquestração; evitar adicionar lógica. Extração só com teste focal. |
| `packages/pi-stack/extensions/guardrails-core-autonomy-lane-surface-helpers.ts` | 1194 | local-safe audit primeiro | Agrupar helpers por família antes de mover código. Preservar política de protected-scope. |
| `packages/pi-stack/extensions/monitor-provider-patch.ts` | 1028 | local-safe audit primeiro | Mapear normalizers/parsers puros; monitor behavior é advisory, mas a versão durável precisa testes. |
| `packages/pi-stack/extensions/context-watchdog.ts` | 999 | public-API-sensitive | Planejar antes; evitar broad rewrite em `context-watchdog-public-api.ts`. |
| `packages/pi-stack/extensions/quota-visibility-model.ts` | 978 | protected-adjacent | Cuidado: cálculo de quota/provider/cost encosta em `TASK-BUD-849`; preferir audit/formatting até haver foco. |
| `packages/pi-stack/extensions/guardrails-core-lane-queue.ts` | 963 | local-safe com cautela | Mutations e scheduler-adjacent behavior pedem testes antes de extração. |
| `packages/pi-stack/extensions/guardrails-core-unattended-continuation.ts` | 949 | local-safe policy-sensitive | Separar policy/formatting/gates com regressão. |
| `packages/pi-stack/extensions/quota-visibility.ts` | 930 | protected-adjacent | Evitar mudanças de provider/cost sem foco; audit/formatting/documentação continuam seguros. |

## Fila local-safe já semeada

| Task | Tipo | Objetivo | Precisa entrevista? |
| --- | --- | --- | --- |
| `TASK-BUD-873` | síntese | Este mapa de runway. | Não |
| `TASK-BUD-874` | audit | `guardrails-core.ts` rumo a <=1000 linhas. | Não |
| `TASK-BUD-875` | audit | Helpers da autonomy lane. | Não |
| `TASK-BUD-876` | audit | `monitor-provider-patch.ts`. | Não |
| `TASK-BUD-877` | plan-only | `context-watchdog` sem rewrite amplo. | Não |
| `TASK-BUD-878` | board clarity | Separar macro/protected items em trilhas claras. | Não |
| `TASK-BUD-879` | interview packet | Preparar perguntas mínimas para `TASK-BUD-849`. | Só depois do pacote |

## Fatias locais adicionais que podem ser semeadas depois

Estas não precisam de decisão humana se mantidas pequenas:

1. Extrair somente tipos/constantes de `guardrails-core.ts` se o audit apontar seam trivial.
2. Extrair helper puro de summary/formatting da autonomy lane, sem tocar seleção.
3. Criar fixture de regression para `monitor-provider-patch.ts` antes de qualquer extração.
4. Criar check documental de line-budget para arquivos `900..1000` quando forem tocados.
5. Adicionar smoke de registration/wiring para proteger futuras extrações de `guardrails-core.ts`.
6. Separar docs de protected leftovers em tasks futuras específicas, sem unpark automático.
7. Melhorar clarity score decompondo itens macro em audit vs implementação.
8. Consolidar mapas de rollback por superfície antes de extrações maiores.

## Decisões que realmente precisam entrevista

Estas devem ficar protegidas até o usuário escolher tradeoffs:

| Tema | Por que precisa humano |
| --- | --- |
| `TASK-BUD-849` Model Infrastructure | Tradeoff de custo, privacidade, provider independence, API pública e UX de roteamento. |
| `handoff_advisor execute=true` | Pode trocar provider/model ativo. |
| `safe_boot apply/restore` UX | Mexe em `.pi/settings.json`; rollback e defaults precisam intenção explícita. |
| `claude_code_execute` UX | Executa subprocesso externo e consome budget/rate-limit. |
| Colônia/scheduler/remote evolution | Envolve protected scope, long-run e coordenação operacional. |

## Critério para voltar a arquitetura forte

Podemos considerar a fase de limpeza/alinhamento pronta quando:

- `board_planning_clarity_score` sair de `needs-decomposition` para uma faixa forte ou claramente explicada;
- os 3 arquivos acima de 1000 linhas tiverem audit com seams e testes definidos;
- `context-watchdog` tiver plano public-API-sensitive explícito;
- protected leftovers estiverem documentados e não misturados com cleanup local-safe;
- `TASK-BUD-849` tiver um interview packet curto, pronto para decisão;
- cada extração futura tiver rollback e focal gate antes de editar.

## Recomendação

Continuar por `TASK-BUD-874` imediatamente. Isso mantém throughput local-safe e começa a transformar side quests em runway arquitetural real. A evolução forte não deve começar por provider/model/API; deve começar por reduzir superfícies grandes com testes, preservar governança e chegar no `TASK-BUD-849` com perguntas mínimas e evidência limpa.
