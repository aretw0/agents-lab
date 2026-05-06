# Lane local-safe de composição 0.8.0

Data: 2026-05-06  
Status: charter ativo da lane  
Foco canônico inicial: `TASK-BUD-917`  
Milestone: `0.8-local-safe-compounding-lane`

## Propósito

Esta lane é o caminho pragmático para voltar das muitas influências úteis para poder controlado, auditado e reversível rumo à 0.8.0.

O objetivo é permitir que o control plane continue evoluindo com baixa iteração humana por meio de fatias pequenas e local-safe que se acumulam:

- limpeza que reduz custo futuro de manutenção;
- pesquisa bounded que transforma abas abertas em planos reutilizáveis;
- mapas de readiness e documentação que tornam resume/handoff mais claros;
- preparação report-only de delegação e long-run;
- validação e rollback que preparam autonomia mais forte sem habilitá-la silenciosamente.

Esta lane não autoriza automação mais forte. Ela cria a pista para que automação mais forte seja menos arriscada depois.

## Modo operacional

Modo padrão: **L1 — execução direta pelo control plane**.

Padrão permitido de continuidade:

1. escolher uma task do board na milestone `0.8-local-safe-compounding-lane`;
2. manter a fatia pequena e reversível;
3. editar apenas arquivos declarados ou um conjunto claramente bounded;
4. rodar uma validação focal;
5. registrar verificação ou nota no board;
6. commitar apenas arquivos intencionais;
7. atualizar handoff quando houver estado de warn/checkpoint;
8. continuar para a próxima fatia local-safe apenas se escopo, validação e rollback estiverem claros.

Pare em vez de continuar quando o próximo passo for protegido, ambíguo, destrutivo ou exigir decisão real de produto/operador.

## O que pode avançar sem nova iteração humana

O agente pode continuar sem perguntar quando todos os pontos abaixo forem verdadeiros:

- o escopo é local-first e reversível;
- os arquivos são documentação, testes, helpers report-only ou artefatos de board/handoff;
- não há credenciais, mutação de rede, publish/deploy, mutação de CI, roteamento/settings de provider, aplicação de override de monitor, remote/offload, scheduler ou limpeza destrutiva;
- a validação é conhecida antes da edição;
- o rollback é simples: reverter o commit ou restaurar o arquivo editado;
- a próxima ação segue os critérios de aceite da task/lane ativa.

Classes boas para continuidade com baixa iteração:

| Classe de fatia | Exemplos | Validação | Rollback |
|---|---|---|---|
| Síntese documental | readiness maps, runbooks, resumos de influências parked | marker check, existência de links/paths, i18n lint se user-facing | reverter commit de docs |
| Higiene de board | decompor macro tasks, adicionar rationale, park de escopo protegido | relatórios de dependência/clareza do board | reverter commit de board |
| Testes local-safe | cobertura smoke de helpers puros/report-only | teste focal | reverter commit de teste/código |
| Primitivas report-only | readiness packets, score summaries, planners determinísticos | smoke focal + assertivas no-dispatch | reverter commit do helper |
| Limpeza | remover referências stale, clarificar guias, deduplicar docs | grep/marker/smoke focal | reverter commit de limpeza |
| Preparação long-run | docs de handoff/readiness/stop-condition e guards fail-closed | smokes de context-watch/autonomy | reverter commit |
| Preparação de delegação | síntese de capability/readiness, packets de start no-dispatch | testes de readiness packet | reverter commit |

## O que não pode avançar sem aprovação explícita

Os itens abaixo são protegidos ou de blast radius alto e ficam parked até aprovação explícita da fatia específica:

- mutação de GitHub Actions / CI/CD;
- mudanças de provider/model routing;
- mudanças de política em `.pi/settings.json` além de notas/documentação de board;
- aplicação de overrides como `/monitor-provider apply`;
- API keys, credenciais ou billing;
- publish, release, deploy ou promoção de pacote;
- execução remota, offload, scheduler ou lançamento de servidor/processo em background;
- limpeza destrutiva, git GC/prune ou deleção massiva;
- mutação de `node_modules`;
- fechamento automático de tasks baseado apenas em sinais externos.

Backlogs protegidos atualmente parked:

- `TASK-BUD-914` — coesão CI/CD e GitHub Actions;
- `TASK-BUD-915` — feedback stale e economia de tokens dos monitores;
- `TASK-BUD-916` — warning de reload sobre overrides divergentes de monitor-provider;
- partes protegidas de `TASK-BUD-849` — maturidade de model infrastructure/routing.

## Condições de parada

Pare e faça checkpoint quando qualquer condição aparecer:

- a validação é desconhecida ou falha de modo que exige julgamento de produto;
- a edição planejada toca escopo protegido;
- a task depende de dashboards externos, provider policy, secrets, billing, runners remotos ou mutações no GitHub;
- o git contém mudanças inesperadas e não relacionadas;
- context-watch chega a checkpoint/compact e o handoff não está fresco;
- feedback de monitor conflita com evidência posterior de board/commit e não pode ser resolvido deterministicamente;
- o próximo passo aumentaria o nível de autonomia (simple-delegate, swarm, scheduler, remote/offload) em vez de apenas preparar isso em modo report-only.

## Expectativas de validação

Toda fatia deve declarar o menor gate confiável antes de editar:

- docs-only: `safe_marker_check`, grep de path/link ou i18n lint para texto user-facing;
- board-only: `board_dependency_health_snapshot`, `board_planning_clarity_score` ou decision packet específico;
- helper de código/teste: `npm run test:smoke -- --run <test>` ou `node --test <file>` focal;
- superfície runtime compartilhada: smoke focal primeiro, depois `npm run ci:smoke:gate` apenas quando a fatia muda comportamento compartilhado;
- handoff/resume: `context_watch_continuation_readiness` mais git limpo.

## Expectativas de rollback

O rollback padrão é reverter o commit. Se a fatia não puder ser revertida por um commit, ela é grande demais para esta lane.

Para cada fatia, registre:

- arquivos tocados;
- comando/ferramenta de validação;
- cue de rollback;
- se algum limite protegido foi aproximado.

## Loop de aprendizado

A lane deve aprender com a própria execução sem virar ruído:

1. capturar atrito recorrente como backlog apenas uma vez;
2. se recorrer, endurecer com regra documentada, primitiva, regressão ou guard runtime;
3. preferir pre-filtros determinísticos antes de chamadas LLM de classifier;
4. resumir aprendizados em docs compactos, não em prompts cada vez maiores ou chatter de monitor;
5. assimilar influências de forma bounded: extrair padrões, não perseguir ecossistemas.

## Primeira fila atual

1. `TASK-BUD-917` — este charter.
2. `TASK-BUD-918` — mapa de readiness 0.8.0.
3. `TASK-BUD-919` — fila de 7 fatias local-safe validadas.
4. `TASK-BUD-920` — higiene de planejamento/foco.
5. `TASK-BUD-921` — runway report-only de delegação e long-run.

## Resumo para operador

Use esta lane quando a instrução for, na prática: “continue melhorando agents-lab/pi-stack sem precisar de mim a menos que apareça risco”.

Avance automaticamente em limpeza local-safe, pesquisa bounded, docs/readiness, preparação report-only de delegação/long-run e testes. Pare para CI/CD, provider/settings/routing, aplicação de override de monitor, publish/deploy, remote/offload, trabalho destrutivo ou decisão de produto ambígua.
