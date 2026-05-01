# @aretw0/pi-skills

> Skills para criar, configurar e operar o ecossistema pi.

## Skills

| Skill | Descrição |
|---|---|
| `terminal-setup` | Diagnóstico e configuração de terminal — Kitty protocol, keybindings, shell path |
| `create-pi-skill` | Como criar uma skill para pi — estrutura, frontmatter, empacotamento |
| `create-pi-extension` | Como criar uma extensão TypeScript — tools, commands, eventos, UI (inclui ponte para web) |
| `create-pi-web-extension` | Como criar/extender extensão web first-party com contrato determinístico e testes (smoke + e2e) |
| `create-pi-theme` | Como criar um tema visual para o TUI |
| `create-pi-prompt` | Como criar prompt templates — argumentos, empacotamento |
| `project-intake` | Triagem inicial agnóstica para iniciar projetos com primeira fatia local-safe |

## Uso

```bash
pi install npm:@aretw0/pi-skills
```

Após instalação, as skills ficam disponíveis como `/skill:terminal-setup`, `/skill:create-pi-skill`, etc.

## Para quem é

- Quem está configurando o pi pela primeira vez
- Quem quer criar extensões, skills ou temas para o ecossistema
- Quem quer entender quando usar skill vs extension vs prompt template

## Instalação via git

Para a versão mais recente sem esperar publish:

```bash
pi install https://github.com/aretw0/agents-lab
```

Isso instala todos os pacotes `@aretw0/*` de uma vez.

## Repositório

[github.com/aretw0/agents-lab](https://github.com/aretw0/agents-lab)

## Licença

MIT
