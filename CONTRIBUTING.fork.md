# Contribuindo com este Fork

Este é um fork de [aretw0/agents-lab](https://github.com/aretw0/agents-lab)
mantido para colaboração ativa com o projeto upstream.

> Para as diretrizes gerais do laboratório (estrutura, nomenclatura, changesets,
> releases), consulte o [CONTRIBUTING.md original](./CONTRIBUTING.md) — estas
> diretrizes **complementam**, não substituem, as do upstream.

---

## Diretivas deste Fork

### 1. Branches — nunca trabalhe direto na `main`

Toda implementação deve começar em uma branch dedicada:

```bash
# Convenção de nomenclatura
git checkout -b feat/descricao-curta        # nova feature ou experimento
git checkout -b fix/descricao-do-bug        # correção
git checkout -b docs/descricao              # documentação
git checkout -b chore/descricao             # manutenção
```

A `main` só recebe código validado, via Pull Request aprovado.

### 2. Fluxo de PR

```
branch de trabalho → PR → revisão → merge na main → (se upstream) → PR upstream
```

**Antes de abrir um PR:**
- Certifique-se de que os testes passam (`npm run test:smoke` e `npm test`)
- Atualize o `CHANGELOG.md` na seção `[Não lançado]`
- Atualize qualquer documentação afetada (README, docs/, experimento)
- Use o template de PR em `.github/PULL_REQUEST_TEMPLATE.md`

**PRs e issues upstream:**
Sempre que um PR puder ser relevante para o repositório original, será perguntado
**antes do merge** se deve ser enviado como PR upstream. Nesse caso:
- Verifique se já existe uma issue aberta em `aretw0/agents-lab`
- Se não existir, abra a issue primeiro, aguarde feedback
- Referencie a issue no PR com `Closes aretw0/agents-lab#XX` ou `Related to aretw0/agents-lab#XX`

### 3. Documentação — sempre atualizada junto com o código

Qualquer mudança que altere comportamento, estrutura ou decisões de design
**deve** vir acompanhada de atualização de documentação:

| O que mudou | O que atualizar |
|-------------|----------------|
| Feature nova | `CHANGELOG.md` + README ou docs/ relevante |
| Experimento | `experiments/<nome>/README.md` + `experiments/README.md` (tabela) |
| Primitiva | `primitives/README.md` + `docs/primitives/` |
| Pacote `packages/*` | `packages/<nome>/CHANGELOG.md` via `npx changeset` + `CHANGELOG.md` raiz |
| Decisão de design | `ROADMAP.md` (seção Decisões Pendentes) |
| Configuração de workspace | `CHANGELOG.md` + comentário no arquivo modificado |

**CHANGELOG.md da raiz** segue o formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/):

```markdown
## [Não lançado]

### Adicionado
- Descrição clara do que foi adicionado

### Modificado
- Descrição do que foi alterado

### Corrigido
- Descrição do bug corrigido
```

### 4. Sincronização com o upstream

Para manter o fork atualizado com o repositório original:

```bash
# Buscar mudanças do upstream
git fetch upstream

# Incorporar na main local (sem rebase, para preservar histórico do fork)
git checkout main
git merge upstream/main --no-ff -m "chore: sync upstream main"

# Resolver conflitos se houver, então:
git push origin main
```

Sincronizações devem ser registradas no `CHANGELOG.md`:

```markdown
### Sincronizado
- Upstream `aretw0/agents-lab` até commit `<sha>` (YYYY-MM-DD)
```

### 5. Segredos e Credenciais

- **Nunca** commite `.env`, tokens, chaves de API ou credenciais
- Use `.env.example` como template com valores fictícios
- Credenciais de provider (LLM) são **separadas** de credenciais operacionais (`gh`, etc.)

---

## Fluxo Completo de uma Contribuição

```text
1. Identifique o trabalho
   └─ Issue local ou issue no upstream?

2. Crie uma branch
   └─ git checkout -b feat/minha-feature

3. Implemente + documente
   ├─ código / experimento / docs
   ├─ atualize CHANGELOG.md → [Não lançado]
   └─ npm run test:smoke (se afetar packages/)

4. Abra um PR para este fork
   ├─ Use o template de PR
   └─ Preencha a seção "Upstream"

5. Revisão e merge na main

6. (Se upstream) Pergunte → abra issue → abra PR upstream
```

---

## Referências

- [CONTRIBUTING.md do upstream](./CONTRIBUTING.md)
- [CHANGELOG.md deste fork](./CHANGELOG.md)
- [ROADMAP.md](./ROADMAP.md)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)
