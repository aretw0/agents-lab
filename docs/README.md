# Documentação — agents-lab

Este diretório centraliza a documentação operacional, arquitetural e de pesquisa do laboratório. Comece por [start-here.md](./start-here.md) para escolher o caminho de leitura correto.

## Estrutura

| Pasta | Conteúdo |
|-------|----------|
| [`start-here.md`](./start-here.md) | Entrada por perfil: usuário, maintainer, operador control-plane, arquitetura e docs |
| [`research/`](./research/) | Pesquisas, análises e material de referência sobre agentes |
| [`guides/`](./guides/) | Guias práticos de uso, configuração e boas práticas |
| [`primitives/`](./primitives/) | Conceitos, catálogo e especificações de primitivas reutilizáveis |
| [`engines/`](./engines/) | Comparações e análises de engines (Pi e alternativas) |
| [`architecture/`](./architecture/) | Decisões arquiteturais, ownership por capability, diagramas e designs de sistema |

## Convenções

- Documentos são escritos em **Markdown**.
- Nomes de arquivos usam **kebab-case** (ex.: `pi-agent-core.md`).
- Cada subdiretório tem seu próprio `README.md` como índice.
- Pesquisas e análises incluem data de criação no frontmatter (quando relevante).

## Contribuindo com Documentação

Veja [CONTRIBUTING.md](../CONTRIBUTING.md) para as diretrizes gerais.
Para documentação especificamente:
1. Identifique o subdiretório correto para o seu conteúdo.
2. Crie um arquivo `.md` com nome descritivo.
3. Atualize o `README.md` do subdiretório para referenciar o novo arquivo.
