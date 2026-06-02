# Research: TASK-BUD-676 — Influência externa parked: avaliar claude-mem

**Executor:** colony-worker
**Data:** 2026-05-29
**Budget usado:** $0.00 de $2.00
**Status:** completo

## Objetivo

Reproduzir a descrição da task `TASK-BUD-676`: avaliar o projeto `https://github.com/aretw0/claude-mem` como referência de memória/sessão para continuidade local-first e governança.

## Fontes Consultadas

- `/home/vscode/.cache/checkouts/github.com/aretw0/claude-mem/docs/public/architecture/hooks.mdx`
- `/home/vscode/.cache/checkouts/github.com/aretw0/claude-mem/docs/public/architecture/database.mdx`
- `/home/vscode/.cache/checkouts/github.com/aretw0/claude-mem/docs/public/architecture/worker-service.mdx`
- `/home/vscode/.cache/checkouts/github.com/aretw0/claude-mem/docs/public/configuration.mdx`
- `/home/vscode/.cache/checkouts/github.com/aretw0/claude-mem/docs/public/usage/private-tags.mdx`
- `/home/vscode/.cache/checkouts/github.com/aretw0/claude-mem/docs/public/progressive-disclosure.mdx`
- `/home/vscode/.cache/checkouts/github.com/aretw0/claude-mem/src/shared/worker-utils.ts`
- `/home/vscode/.cache/checkouts/github.com/aretw0/claude-mem/src/services/worker-spawner.ts`
- `/home/vscode/.cache/checkouts/github.com/aretw0/claude-mem/src/cli/handlers/context.ts`
- `/home/vscode/.cache/checkouts/github.com/aretw0/claude-mem/src/shared/tag-stripping.ts`
- `docs/superpowers/specs/2026-05-29-colony-dogfood-design.md`

## Síntese

O `claude-mem` é um modelo útil para continuidade local-first porque define uma trilha persistente por sessão em SQLite local (`~/.claude-mem/claude-mem.db`) com WAL e FTS5, preservando observações, resumos e prompts por projeto e por sessão. O design separa fortemente o fluxo de hooks do processamento pesado no worker (Express/Bun, HTTP), reduzindo risco de bloqueio do IDE no caminho de interação em tempo real.

Uma escolha importante para nós é o padrão de **injeção progressiva de contexto**: o hook de início retorna um índice compacto com custo estimado por item e deixa a recuperação profunda para ferramentas (`get_observations`, `search`, etc.) sob demanda. Isso endereça dois problemas típicos do agents-lab: economia de tokens na continuidade e menor ruído de contexto. O sistema também já traz telemetria de custo/benefício no terminal (`Read cost`, `Work investment`, `Savings`), útil para governança de budget.

O projeto traz práticas de governança fortes em persistência sensível: stripping de tags `<private>` no edge (UserPromptSubmit/PostToolUse) e no worker, para evitar que dados sensíveis cheguem ao banco; e health/spawn do worker com verificação robusta (PID/port, backoff, retry, fallback). A arquitetura também explicita exclusões (projetos/rotinas) e controles de `skip` de ferramentas, permitindo reduzir ruído de rastreamento.

No ponto de implantação local, entretanto, há custo operacional não trivial: dependências opcionais/externas (Bun, uv para Chroma, provedor LLM para sumarização) e um processo de background contínuo por usuário. Ainda assim, o envelope é bem delimitado e pode ser adaptado a um `agents-lab` que já privilegia controle por gates.

## Padrões Reaproveitáveis

| Padrão | Onde se aplica no agents-lab | Risco de adoção |
|--------|-------------------------------|-----------------|
| **Memória persistida por sessão em SQLite local + índices FTS5** | `packages/context-watchdog` para guardar timeline local de eventos já estruturados | baixo |
| **Contexto em 3 camadas (índice -> resumo por sessão -> detalhe sob demanda)** | Melhoria do bootstrap de `SessionStart` para reduzir poluição de contexto e custo de tokens | médio |
| **Separação de caminho de hook e processamento assíncrono** | `ant_colony`/worker tasks: guardar evidência rápida e processar resumos fora do ciclo crítico do hook | médio |
| **Strip de tags `<private>` em entrada de usuário e tool data antes da persistência** | Camada única de privacidade aplicada a logs de continuidade local e transcrições | baixo |
| **Detecção automática de indisponibilidade de worker + fallback silencioso em alguns hooks** | Robustez quando serviços auxiliares falham (evita quebrar sessão, mantém operação principal) | baixo |

## Riscos e Limites

- Dependência de stack extra para produção completa (Bun e, em modo com vetor semântico, `uv`/Chroma) aumenta superfície operacional.
- O projeto mantém worker assíncrono em background (`~100–200MB` no runtime típico segundo docs), o que impacta uso em máquinas menores.
- A sumarização depende de modelo remoto; custo/latência variam por provedor, ainda que parte do fluxo seja local.
- A própria busca semântica pode ficar obsoleta sem manutenção/atualização do modo de armazenamento e sem observabilidade contínua de migrações.
- Esta pesquisa não executou `ant_colony` de fato (faltam capabilities `colony`/`colonyStop` no ambiente), portanto não cobre riscos de integração operacional end-to-end no fluxo real da colônia.

## Proposta de Próximos Passos

- Seguir com experimento bounded de implementação no agents-lab para incorporar um modo de continuidade por camadas com contexto-índice primeiro, sem ativar por padrão o armazenamento completo.
- Definir rollout mínimo: adapter de memória local com persistência opcional, fallback seguro quando o backend não responde, e `private tags` antes de armazenamento.
- Promover artefato para revisão de risco e priorização da Fase 2 se houver aprovação explícita de implantação parcial.