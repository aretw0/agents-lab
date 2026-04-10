# Contribuindo com o agents-lab

Obrigado por querer contribuir! Este laboratório é um espaço colaborativo de pesquisa e desenvolvimento de agentes de IA.

## Como Contribuir

### Adicionando uma Pesquisa ou Análise

1. Crie um arquivo `.md` em [`docs/research/`](./docs/research/).
2. Use o formato documentado no [README de pesquisas](./docs/research/README.md).
3. Atualize o índice em [`docs/research/README.md`](./docs/research/README.md).
4. Abra um PR com uma descrição clara do conteúdo adicionado.

### Adicionando um Guia

1. Crie um arquivo `.md` em [`docs/guides/`](./docs/guides/).
2. Inclua pré-requisitos, passo a passo e exemplos de código funcionais.
3. Atualize o índice em [`docs/guides/README.md`](./docs/guides/README.md).
4. Abra um PR com uma descrição clara do guia adicionado.

### Adicionando um Experimento

1. Crie um subdiretório em [`experiments/`](./experiments/) com o formato `YYYYMM-nome-descritivo`.
2. Inclua um `README.md` seguindo o [formato de experimento](./experiments/README.md).
3. Nunca commite chaves de API ou segredos — use `.env.example`.
4. Abra um PR descrevendo o objetivo e os resultados iniciais.

### Promovendo uma Primitiva

1. O experimento de origem deve estar documentado e com resultados claros.
2. Crie um subdiretório em [`primitives/`](./primitives/).
3. Siga os [princípios de design de primitivas](./docs/primitives/README.md).
4. Atualize o catálogo em [`docs/primitives/README.md`](./docs/primitives/README.md).
5. Abra um PR referenciando o experimento de origem.

### Atualizando Análises de Engines

1. Edite ou crie arquivos em [`docs/engines/`](./docs/engines/).
2. Use os [critérios de avaliação padronizados](./docs/engines/README.md).
3. Abra um PR com a análise.

## Diretrizes Gerais

- **Idioma:** Documentação principal em **Português (BR)**; código e comentários técnicos podem ser em inglês.
- **Markdown:** Use Markdown padrão com tabelas e blocos de código quando apropriado.
- **Nomenclatura de arquivos:** Use **kebab-case** (ex.: `pi-agent-core.md`).
- **Segredos:** Nunca commite chaves de API, tokens ou credenciais.
- **PRs pequenos:** Prefira PRs focados em um único tópico.
- **Contexto:** Inclua sempre o contexto de por que a contribuição é relevante para o laboratório.
- **Workspace:** Artefatos gerados por engines e extensões devem ser entendidos antes de serem ignorados, removidos ou promovidos a convenção do projeto.
- **Overrides locais:** Configurações intencionais em `.pi/agents/` podem ser versionadas quando corrigem ou explicitam comportamento do workspace; saídas operacionais como `.project/` devem ser tratadas como runtime até que virem primitivas ou convenções estáveis.

## Discussões

Abra uma [Issue](../../issues) para:

- Propor novos temas de pesquisa
- Sugerir novas primitivas
- Discutir a estrutura do laboratório
- Trazer material para análise

## Código de Conduta

Este laboratório é um espaço de aprendizado e colaboração. Seja respeitoso, construtivo e aberto a diferentes perspectivas.
