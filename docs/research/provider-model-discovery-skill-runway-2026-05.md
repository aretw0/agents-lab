# Provider model discovery skill runway — 2026-05

Status: primitive cultivation / report-only  
Tarefa: `TASK-BUD-905`  
Relacionado: `TASK-BUD-904`, `TASK-BUD-906`, `TASK-BUD-849` protegido

## 1. Decisão

Promover o padrão `provider-model-discovery` primeiro como **skill report-only**, não como extensão.

Motivo:

- o padrão ainda é principalmente instrução, curadoria e documentação;
- não exige estado persistente, UI ou tool first-party para a primeira versão;
- execução real de canary/provider continua protegida;
- uma skill reduz repetição sem abrir caminho automático para settings/routing/paid spend.

## 2. Evidência que justificou a skill

O padrão apareceu durante a assimilação Alibaba/Qwen:

1. verificar env var sem vazar segredo;
2. listar modelos via endpoint read-only `/models`;
3. classificar ids por famílias (`flash`, `plus`, `max`, `coder`, `turbo`);
4. buscar docs oficiais de modelos, quota, cobrança e rate limit;
5. convergir fontes públicas/terceiras sem substituir docs oficiais;
6. produzir shortlist pequena;
7. preparar packet protegido, sem autorizar execução.

## 3. Artefato criado

Skill skeleton:

- `packages/lab-skills/skills/provider-model-discovery/SKILL.md`

Superfícies de documentação atualizadas:

- `packages/lab-skills/README.md`
- `README.md`
- `docs/guides/recommended-pi-stack.md`
- `packages/pi-stack/README.md`

## 4. O que a skill permite

Permitido por padrão:

- verificar presença/tamanho de env var sem imprimir valor;
- consultar listagem de modelos read-only;
- usar web-search/fetch para documentação pública;
- classificar famílias por nome;
- registrar gates oficiais de quota/billing/rate;
- criar shortlist e canary packet report-only.

Não permitido sem aprovação explícita:

- prompt/completion calls;
- provider smoke;
- settings/routing/monitor migration;
- paid spend;
- scheduler/loop/retry automático;
- armazenamento de segredo.

## 5. Critério para promoção futura a extensão/tool

Só considerar extensão first-party se houver pelo menos um destes sinais:

- o fluxo for repetido em 3+ providers;
- precisarmos normalizar `/models` entre providers;
- precisarmos cachear inventário com timestamp e region awareness;
- precisarmos gerar scorecards estruturados automaticamente;
- precisarmos de tool que falhe fechado quando o operador tenta prompt call sem gates;
- dashboard/quota puder ser lido de forma segura e provider-approved.

Até lá, skill é suficiente.

## 6. Próxima validação futura

Quando houver nova assimilação de provider, usar a skill em modo manual e registrar:

- tempo até shortlist útil;
- se a skill evitou vazamento de key;
- se distinguiu API listagem vs quota/preço;
- se produziu protected canary packet sem autorizar execução;
- se faltou alguma etapa para docs oficiais.
