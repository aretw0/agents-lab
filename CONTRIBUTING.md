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

### Desenvolvendo um Pacote First-Party

Os pacotes first-party vivem em `packages/` e são distribuídos como `@aretw0/*` no npm.

1. Crie um diretório em `packages/meu-pacote/` com `package.json` e `README.md`.
2. Ative o modo desenvolvimento local:
   ```bash
   npm run pi:local     # aponta pi para os workspace paths
   ```
3. Faça `/reload` no pi para carregar o pacote.
4. Quando a mudança estiver pronta, crie um changeset (ver abaixo).
5. Quando o pacote estiver maduro, adicione-o à lista em `packages/pi-stack/package-list.mjs`.

### Alternando entre Desenvolvimento e Produção

O script `pi-source-switch.mjs` alterna os pacotes do pi entre local e npm:

```bash
npm run pi:local       # aponta pi para packages/ do monorepo
npm run pi:published   # volta para npm:@aretw0/*
npm run pi:status      # mostra configuração atual
```

Isso reescreve o `~/.pi/agent/settings.json`. Use `--pi-local` para escrever no `.pi/settings.json` do projeto.

### Testando Extensões

Use `@marcfargas/pi-test-harness` para testes automatizados:

```bash
# Testes smoke (vitest)
npm run test:smoke

# Testes unitários (node:test)
npm test
```

A skill `test-pi-extension` documenta como usar o test-harness. Veja exemplos em `packages/pi-stack/test/`.

### Promovendo uma Primitiva

1. O experimento de origem deve estar documentado e com resultados claros.
2. Crie um subdiretório em [`primitives/`](./primitives/).
3. Siga os [princípios de design de primitivas](./docs/primitives/README.md).
4. Atualize o catálogo em [`docs/primitives/README.md`](./docs/primitives/README.md).
5. Abra um PR referenciando o experimento de origem.

## Workflow de Release

Este monorepo usa [Changesets](https://github.com/changesets/changesets) com versionamento lockstep.
Todos os pacotes `@aretw0/*` compartilham a mesma versão.

### Documentar uma mudança distribuível

Sempre que alterar algo em `packages/` que mereça release:

```bash
npx changeset
# Escolha: qual pacote, tipo (patch/minor/major), descrição da mudança
git add .changeset/
git commit -m "..."
```

Mudanças em `docs/`, `experiments/` ou configurações internas não precisam de changeset.

### Fazer um release

Ver guia completo em [`docs/guides/publishing.md`](./docs/guides/publishing.md).

```bash
npm run release              # bumpa versões + atualiza CHANGELOG.md
git add .
git commit -m "chore: release vX.X.X"
git tag vX.X.X
git push && git push --tags  # GitHub Actions publica no npm
```

## Diretrizes Gerais

- **Idioma:** Documentação principal em **Português (BR)**; código e comentários técnicos podem ser em inglês.
- **Markdown:** Use Markdown padrão com tabelas e blocos de código quando apropriado.
- **Nomenclatura de arquivos:** Use **kebab-case** (ex.: `pi-agent-core.md`).
- **Commits:** Seguir [Conventional Commits](https://www.conventionalcommits.org/) — o CI valida.
- **Segredos:** Nunca commite chaves de API, tokens ou credenciais.
- **PRs pequenos:** Prefira PRs focados em um único tópico.
- **Contexto:** Inclua sempre o contexto de por que a contribuição é relevante para o laboratório.

## Discussões

Abra uma [Issue](../../issues) para:

- Propor novos temas de pesquisa
- Sugerir novas primitivas
- Discutir a estrutura do laboratório
- Trazer material para análise

## Código de Conduta

Este laboratório é um espaço de aprendizado e colaboração. Seja respeitoso, construtivo e aberto a diferentes perspectivas.
