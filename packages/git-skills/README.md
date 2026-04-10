# @aretw0/git-skills

> First-party git skills para o agents-lab — GitHub (`gh`), GitLab (`glab`), workflow e convenções de commit.

## Skills

| Skill | Descrição |
|---|---|
| `commit` | Como fazer commits no estilo Conventional Commits |
| `git-workflow` | Estratégia de branching, PRs/MRs, resolução de conflitos e operações não-interativas |
| `github` | `gh` CLI — issues, PRs, CI runs, releases e API queries |
| `glab` | `glab` CLI — issues, merge requests, CI pipelines e API queries |

## Uso

```bash
pi install npm:@aretw0/git-skills
```

Ou via projeto:

```json
{
  "packages": ["./packages/git-skills"]
}
```

## Filosofia

Estas são primitivas first-party do agents-lab. As skills de referência (`mitsupi/github`, `mitsupi/commit`, `@ifi/git-workflow`) foram curadas e decompostas:

- `commit` e `git-workflow` são separados intencionalmente — cada um tem uma preocupação distinta
- `github` e `glab` são paralelos — mesma estrutura, CLIs diferentes
- Nenhuma skill repete informação de outra

## Proveniência

| Skill | Baseada em |
|---|---|
| `commit` | `mitsupi/skills/commit` (MIT) |
| `git-workflow` | `@ifi/oh-pi-skills/git-workflow` (MIT) — seção de commit removida |
| `github` | `mitsupi/skills/github` (MIT) — expandida com issues e escrita |
| `glab` | First-party original, modelada a partir de `github` |
