# Scorecard de canary Dashscope — 2026-05

## Contexto

Canary local-safe aprovado para comparar provider/model e observar ergonomia do control-plane após o canary Spark.

## Provider/model

- Provider/model ref: `dashscope/qwen-plus`
- Escopo: uma fatia docs-only com dois arquivos declarados.

## Escopo local-safe

Arquivos declarados:

- `docs/research/provider-canary-scorecard-dashscope-2026-05.md`
- `docs/research/one-slice-control-plane-ergonomics-2026-05.md`

Escopos protegidos não tocados: `.pi/settings.json`, routing, CI, publish, credenciais e config de provider.

## Resultado

Status do canary: **falhou em obediência de tool/path**, mas gerou evidência útil para o cultivo da primitiva.

Evidência:

- Run 1: `provider-canary-dashscope-direct-1778120606017`, estado `completed`, mas não criou os arquivos declarados; respondeu pedindo nomes/conteúdo apesar do prompt já conter ambos.
- Run 2: `provider-canary-dashscope-retry-1778120743078`, estado `completed`, mas criou `file1.txt` e `file2.txt` em vez dos paths declarados.
- Rollback aplicado: `file1.txt` e `file2.txt` removidos.

## Qualidade da resposta

- Obediência a paths declarados: baixa.
- Obediência a "não perguntar": baixa na primeira tentativa.
- Obediência a conteúdo inline: parcial, mas direcionada para nomes genéricos.
- Utilidade como canary: alta para revelar que o control-plane precisa validar arquivos tocados versus declarados automaticamente.

## Observabilidade

- `one_slice_agent_run_status` funcionou para consultar estado da run.
- `one_slice_agent_run_log_tail` mostrou evidência suficiente para diagnosticar a falha.
- O registry registrou provider/model, cwd, arquivos declarados, log path e estado.
- Lacuna: estado `completed` não significa sucesso do contrato; precisa de verificação pós-run acoplada ao registry.

## Limites/risco

- Custo/token usage não foi medido no artifact da run.
- O provider executou escrita fora do caminho declarado, mas em arquivos locais simples e reversíveis.
- Rollback local-safe foi simples: remover `file1.txt` e `file2.txt`.

## Comparação inicial com Spark

- Spark: precisou de retry após timeout, mas criou o arquivo alvo correto na segunda tentativa.
- Dashscope: completou rápido, mas falhou em seguir paths declarados mesmo com retry e prompt explícito.
- Implicação: para canaries com Dashscope, o control-plane deve tratar `completed` como apenas transporte concluído; sucesso depende de diff/marker/path validation.

## Próximo passo

Não rodar novo canary Dashscope antes de cultivar uma primitive de **post-run declared-file validation** e/ou **run comparison** que destaque automaticamente:

- arquivos declarados;
- arquivos realmente tocados;
- markers faltantes;
- rollback sugerido;
- decisão `pass/fail/partial` separada do estado do processo.
