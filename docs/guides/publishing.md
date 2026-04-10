# Publicando Pacotes `@aretw0/*`

Guia completo para fazer releases dos pacotes first-party do agents-lab.

## Pré-requisitos (uma vez só)

### 1. Criar o scope `@aretw0` no npm

Acesse [npmjs.com](https://www.npmjs.com), faça login com a conta `aretw0` e confirme que o scope está disponível. Scopes de usuário (`@aretw0`) são criados automaticamente com a conta.

### 2. Configurar o `NPM_TOKEN` no GitHub

1. Em [npmjs.com → Access Tokens](https://www.npmjs.com/settings/aretw0/tokens), crie um token do tipo **Automation** (não expira com 2FA).
2. No repositório GitHub, vá em **Settings → Secrets and variables → Actions**.
3. Crie um secret chamado `NPM_TOKEN` com o valor do token.

### 3. Habilitar npm provenance (opcional mas recomendado)

O workflow já usa `--provenance`. Para funcionar, o repositório precisa ter **GitHub Actions** com permissão `id-token: write` — já está configurado em `.github/workflows/publish.yml`.

---

## Workflow de Release

### 1. Durante o desenvolvimento — documentar mudanças

Toda alteração em `packages/` que mereça chegar aos usuários precisa de um changeset:

```bash
npx changeset
# Escolha os pacotes afetados
# Escolha o tipo: patch (correção), minor (novo recurso), major (breaking change)
# Escreva uma descrição da mudança
```

O arquivo gerado em `.changeset/*.md` deve ser commitado junto com a mudança:

```bash
git add .changeset/
git commit -m "feat(git-skills): adiciona suporte a glab mr rebase"
```

> Mudanças em `docs/`, `experiments/` ou configurações internas **não precisam** de changeset.

### 2. Na hora de lançar — bumpar versões

```bash
npm run release
```

Isso executa `changeset version`, que:
- Lê todos os changesets pendentes em `.changeset/`
- Bumpa as versões de todos os pacotes `@aretw0/*` em lockstep
- Atualiza o `CHANGELOG.md` na raiz
- Remove os arquivos `.changeset/*.md` usados

Revise as mudanças antes de commitar:

```bash
git diff
```

### 3. Commitar, taggear e publicar

```bash
git add .
git commit -m "chore: release vX.X.X"
git tag vX.X.X
git push && git push --tags
```

O push da tag dispara `.github/workflows/publish.yml` que:
1. Valida que a tag bate com a versão em todos os `package.json`
2. Roda `npm install`
3. Publica `@aretw0/pi-stack`, `@aretw0/git-skills`, `@aretw0/web-skills`, `@aretw0/pi-skills` e `@aretw0/lab-skills` com provenance

> **Nota para usuários via git:** Quem instalou via `pi install https://github.com/aretw0/agents-lab` recebe atualizações com `pi update` sem esperar o publish no npm.

---

## Adicionando um Novo Pacote ao Workflow

Quando um novo pacote first-party (`packages/meu-pacote/`) estiver pronto para publicar:

1. Adicione-o ao `fixed` array em `.changeset/config.json`:
   ```json
   "fixed": [["@aretw0/pi-stack", "@aretw0/git-skills", "@aretw0/web-skills", "@aretw0/meu-pacote"]]
   ```

2. Adicione o passo de publish em `.github/workflows/publish.yml`:
   ```yaml
   - run: npm publish --workspace packages/meu-pacote --provenance --access public
   ```

3. Adicione como dependência do `pi-stack` quando estiver estável.

---

## Tipos de Versão

| Tipo | Quando usar | Exemplo |
|---|---|---|
| `patch` | Correções, melhorias internas, docs de skill | `0.1.0` → `0.1.1` |
| `minor` | Novo recurso, nova skill, nova extension | `0.1.0` → `0.2.0` |
| `major` | Breaking change na API ou remoção de recurso | `0.1.0` → `1.0.0` |

Como todos os pacotes usam lockstep, o changeset de maior impacto define o bump de todos.
