# Scorecard de Canary Local-Safe (unidose)

## Contexto
- Execução: `local-safe`, modo **one-slice** aprovado.
- Objetivo: validar comportamento de resposta do stack do agente no template de análise curta.
- Data de referência: 2026-05.

## Provider/model
- Provider/model ref: `openai-codex/gpt-5.3-codex-spark`
- Provider: **openai-codex**
- Model: **gpt-5.3-codex-spark**

## Escopo local-safe
- Ambiente: repositório local, sem chamadas externas não autorizadas além de componentes já permitidos.
- Tarefa validada: criação de um único arquivo Markdown com estrutura fixa e sem edição de outros arquivos.
- Limite: não executar mudanças de infraestrutura nem instalação/execução de testes.

## Resultado
- Status: **Aprovado** para o cenário canary.
- Entregável: arquivo criado exatamente em `docs/research/provider-canary-scorecard-2026-05.md`.
- Conformidade de formato: seções solicitadas presentes e nomeadas conforme esperado.

## Qualidade da resposta
- Clareza: alta (estrutura objetiva e rastreável).
- Completude: cobriu todos os pontos pedidos.
- Linguagem: português (preservando nomes de provider/model).
- Adequação de tamanho: conciso.

## Observabilidade
- Evidência primária: conteúdo do arquivo gravado.
- Run concluída: `provider-canary-spark-direct-1778120044943`, estado `completed` no registry `one-slice-agent-runs.json`.
- Log tail disponível em `.pi/reports/provider-canary-spark-direct-1778120044943.log`.
- Latência observada da run concluída: aproximadamente 34s.
- Tentativa anterior: `provider-canary-spark-1778119890862` terminou por timeout/SIGTERM em 45s sem saída útil.

## Limites/risco
- Custo/token usage não foi medido no artifact da run; quota live deve continuar sendo consultada via WHAM antes de novos canaries.
- Não houve validação de qualidade semântica externa; avaliação baseada em conformidade estrutural.
- Risco baixo de impacto no repositório por alterar apenas um arquivo novo declarado.
- Rollback local-safe: remover `docs/research/provider-canary-scorecard-2026-05.md` e os logs/registry da run, sem tocar settings/routing/CI/publish/credenciais.

## Próximo passo
- Registrar um segundo canary idêntico em outra data para comparação de estabilidade.
- Incluir, quando necessário, checks de observabilidade (tempo de resposta, token usage, falhas) em logs de benchmark do agente.
