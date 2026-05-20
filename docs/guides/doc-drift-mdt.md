# Doc Drift e MDT

Este guia define como tratar documentação repetida, snippets de política e diagramas como superfície governada. O objetivo é reduzir drift sem transformar docs em um pipeline pesado.

## Posição atual

- `mdt` é uma trilha advisory planejada, não gate bloqueante padrão.
- O repositório ainda não depende de `mdt` instalado.
- Enquanto não houver integração formal, use checks existentes: `repo:discourse:audit`, `docs:package:check`, `repo:bloat:audit` e revisão focal dos índices.

## Contrato para adoção de MDT

1. **Check first**: começar com `mdt check` ou equivalente em escopo pequeno.
2. **Changed files first**: rodar em arquivos alterados antes de varrer docs inteiras.
3. **Ignore code**: ignorar code fences, comandos, paths, IDs, logs, JSON e nomes de API.
4. **Advisory before blocking**: gerar finding e evidência antes de falhar CI.
5. **Update pequeno**: `mdt update` só em blocos pequenos, revisáveis e com diff claro.
6. **No prioritization**: MDT sincroniza documentação; não escolhe roadmap nem fecha task.

## Escopos bons para MDT

| Escopo | Por que usar |
|---|---|
| README raiz + `docs/start-here.md` | manter posicionamento público coerente |
| `docs/guides/README.md` + package copies | evitar links ou descrições divergentes |
| snippets de comandos pnpm/devcontainer | reduzir regressão para `npm run` legado |
| glossário control-plane/operator | evitar aliases e termos paralelos |
| blocos Mermaid/diagramas | detectar drift entre diagrama e runtime descrito |

## Escopos que devem ficar fora no início

- `docs/research/data/**` e logs brutos;
- arquivos em `docs/archive/**`;
- snapshots históricos que preservam comandos antigos;
- generated package guide copies, exceto via `pnpm run docs:package:sync`.

## Critério para CI

Uma futura Action deve começar como report-only:

1. instalar/ativar ferramenta apenas se já estiver pinada e documentada;
2. rodar em PRs com artifact ou comentário curto;
3. não bloquear merge até termos falsos positivos classificados;
4. promover para blocking apenas para regras de alto sinal, como links quebrados em docs públicas ou snippets canônicos divergentes.

## Relação com os gates atuais

- `repo:discourse:audit`: linguagem canônica e claims aspiracionais.
- `docs:package:check`: cópias empacotadas dos guias.
- `repo:bloat:audit`: dados/logs grandes e artefatos versionados.
- `test:ci:workflow`: contrato de workflows GitHub.

MDT deve complementar esses gates, não substituí-los.
