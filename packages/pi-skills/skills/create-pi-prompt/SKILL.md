---
name: create-pi-prompt
description: >
  Como criar prompt templates para pi. Use quando o usuário quiser criar
  atalhos /comando que expandem em prompts completos.
---

# Criando Prompt Templates

Prompt templates são snippets Markdown que viram comandos `/nome` no pi.

## Estrutura

Arquivo `.md` com frontmatter opcional:

```markdown
---
description: Revisa as mudanças staged do git
---
Revise as mudanças staged (`git diff --cached`). Foque em:
- Bugs e erros de lógica
- Problemas de segurança
- Gaps de tratamento de erro
```

O nome do arquivo vira o comando: `review.md` → `/review`

## Argumentos

Templates suportam argumentos posicionais:

- `$1`, `$2`, ... — argumento por posição
- `$@` ou `$ARGUMENTS` — todos os argumentos juntos
- `${@:N}` — argumentos a partir da posição N
- `${@:N:L}` — L argumentos a partir de N

Exemplo:

```markdown
---
description: Cria um componente React
---
Crie um componente React chamado $1 com as features: ${@:2}
```

Uso: `/component Button dark-mode responsive`

## Onde Colocar

| Escopo | Localização |
|---|---|
| Global | `~/.pi/agent/prompts/review.md` |
| Projeto | `.pi/prompts/review.md` |
| Pacote | `prompts/review.md` (com `pi.prompts` no `package.json`) |

## Empacotando

```json
{
  "name": "@aretw0/meus-prompts",
  "keywords": ["pi-package"],
  "pi": {
    "prompts": ["./prompts"]
  }
}
```
