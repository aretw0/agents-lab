# Changesets

Este diretório é gerenciado pelo [@changesets/cli](https://github.com/changesets/changesets).

## Como documentar uma mudança

Sempre que fizer uma alteração que mereça release, crie um changeset:

```bash
npx changeset
```

Escolha os pacotes afetados, o tipo de mudança (`patch`, `minor`, `major`) e descreva o que mudou.

O arquivo gerado vai para `.changeset/*.md` e deve ser commitado junto com a mudança.

## Como fazer um release

```bash
# 1. Bumpa todas as versões e atualiza CHANGELOG.md
npm run release

# 2. Commit e tag
git add .
git commit -m "chore: release vX.X.X"
git tag vX.X.X
git push && git push --tags

# O GitHub Actions publica automaticamente no npm.
```

## Versionamento lockstep

Todos os pacotes `@aretw0/*` compartilham a mesma versão. Um changeset que afeta qualquer pacote
bumpa todos juntos. Isso mantém a curadoria coesa — o `pi-stack` sempre referencia versões
compatíveis dos pacotes first-party.
