# Simple-delegate workflow observability gap — 2026-05

## Contexto

Durante o canary `provider-canary-spark`, o runner de workflow mostrou uma etapa `implement` em andamento, mas o control-plane não tinha uma superfície suficiente para distinguir:

- chamada LLM ainda em voo;
- progresso persistido em `.workflows/runs`;
- worker travado sem heartbeat;
- ausência de artefato alvo apesar de UI ainda parecer ativa.

O operador precisou sair do pi para encerrar o fluxo. Esse incidente bloqueia novos canaries via `pi-workflows` até haver status, log bounded e abort controlados.

## Lacuna observada

O runner de workflow atual é útil para orquestração, mas ainda não é aceitável como executor principal de canaries porque não oferece, no contrato local-safe mínimo:

1. run id consultável por ferramenta;
2. estado atual legível pelo control-plane;
3. heartbeat/último evento persistido;
4. arquivo alvo declarado;
5. provider/model declarado;
6. log tail bounded;
7. abort dry-first com confirmação humana explícita;
8. distinção entre parar worker registrado e matar o processo pai.

## Decisão local-safe

Não usar `pi-workflows` como executor de provider canary enquanto essa lacuna existir.

O degrau aceito para continuar a jornada é `one_slice_agent_run_*`:

- `one_slice_agent_run_plan`: packet report-only; não despacha;
- `one_slice_agent_run_status`: lê registry local; não inicia/para processo;
- `one_slice_agent_run_log_tail`: lê log bounded; não executa processo;
- `one_slice_agent_run_abort`: dry-first; `processStopAllowed=true` só com run registrado, state `running`, pid, cwd esperado e `operator_confirmed=true`.

## Timeout/cooldown recomendado para próximos canaries

Para canaries de provider/model:

- timeout inicial: 45s–90s;
- máximo uma fatia por decisão humana;
- cooldown: revisar status/log antes de qualquer retry;
- rollback: remover apenas artefato alvo declarado e registry/log da run se necessário;
- validação focal: marker/read do arquivo alvo + `git diff --check`.

## Regra de autorização

Docs, tasks, checklists e packets são evidência/planejamento. Eles não autorizam dispatch. A primeira execução real ainda precisa de confirmação humana explícita contendo:

- task id/foco;
- provider/model;
- cwd;
- arquivos declarados;
- timeout;
- validação;
- rollback;
- orçamento;
- parada após uma fatia.
