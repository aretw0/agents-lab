# Ergonomia do control-plane para one-slice agent runs — 2026-05

## Contexto

Os canaries Spark e Dashscope mostraram que o control-plane precisa ver runs como objetos operacionais completos, não só como subprocessos que terminaram.

A unidade mínima útil agora é: objetivo, provider/model, cwd, arquivos declarados, timeout, log, estado, validação pós-run, rollback e decisão de próxima ação.

## O que funcionou

- `one_slice_agent_run_plan` tornou explícito o contrato antes da execução.
- `one_slice_agent_run_status` permitiu consultar estado sem despachar nada.
- `one_slice_agent_run_log_tail` deu visibilidade bounded para diagnosticar timeout, pergunta indevida e escrita em paths errados.
- `one_slice_agent_run_abort` preserva abort dry-first com confirmação humana.
- O registry `one-slice-agent-runs.json` já dá um ponto único de inspeção para run id, provider/model, cwd, arquivos e log.

## Atritos manuais

- Registry append ainda é feito por scripts auxiliares, não por primitive first-party.
- A validação de arquivos declarados versus arquivos tocados ainda é manual.
- O estado `completed` pode mascarar falha de contrato, como no Dashscope criando `file1.txt`/`file2.txt`.
- Comparação entre Spark e Dashscope ainda exige leitura manual de scorecards.
- Quota snapshot ainda não é anexado automaticamente à run.
- Rollback packet ainda não é gerado junto do canary.

## Primitivas candidatas

1. **registry append first-party**
   - Criar/atualizar entrada de run sem scripts ad hoc.
   - Registrar started/heartbeat/done/timeout/failed.

2. **declared-file validation**
   - Comparar arquivos declarados com `git status`/diff pós-run.
   - Separar `processState=completed` de `contractDecision=pass|partial|fail`.

3. **run comparison**
   - Comparar Spark, Dashscope e próximos providers por latência, obediência, retries e validação.

4. **bounded event timeline**
   - Timeline curta com started, first output, tool write, timeout, done e rollback.

5. **quota snapshot**
   - Capturar readiness/cache antes/depois sem alterar routing/settings.

6. **rollback packet**
   - Gerar instrução local-safe derivada de arquivos declarados e arquivos inesperados.

## Sinais que o control-plane merece

- Provider/model real usado.
- Latência total e motivo de saída.
- Arquivos declarados versus arquivos realmente tocados.
- Markers esperados e faltantes.
- Último evento persistido.
- Custo/quota quando disponível.
- Se houve retry e por quê.
- Se rollback foi necessário/aplicado.
- Decisão stop/continue ao fim da fatia.

## Próxima fatia local-safe

Criar uma primitive report-only de **one-slice run outcome packet** que leia registry + git dirty snapshot + marker checks informados e retorne:

- `processState`;
- `contractDecision`;
- arquivos declarados;
- arquivos inesperados;
- validações pass/fail;
- rollback sugerido;
- recomendação `stop|retry-once|ask-human`.

Essa primitive deve vir antes de crescer para workflows, background workers persistentes ou swarms.
