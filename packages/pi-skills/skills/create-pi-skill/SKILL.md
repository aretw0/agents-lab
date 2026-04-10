---
name: create-pi-skill
description: >
  Como criar uma skill para pi. Use quando o usuário quiser criar uma skill nova
  para o projeto ou para publicar como pacote.
---

# Criando uma Skill Pi

Skills são o caminho mais leve para customizar o comportamento do pi. Se o problema é instrução recorrente, comece com skill. Se precisa de hooks, tools, UI ou persistência, vá de extensão.

## Estrutura Mínima

```
skills/minha-skill/
└── SKILL.md
```

O `SKILL.md` é obrigatório. Scripts auxiliares são opcionais.

## Frontmatter

```yaml
---
name: minha-skill
description: >
  Descrição curta do que a skill faz. Aparece no prompt do pi como contexto
  disponível — só a descrição, não o conteúdo completo.
---
```

- `name` — identificador único, usado no comando `/skill:name`
- `description` — o que o pi mostra no system prompt para decidir quando carregar

## Conteúdo

O corpo do SKILL.md são as instruções completas. O pi carrega sob demanda quando a tarefa casa com a descrição. Escreva como se estivesse instruindo o agente diretamente:

- Explique **quando** usar a skill
- Dê **exemplos** com blocos de código executáveis
- Use **comandos bash** que o agente pode rodar via `bash` tool
- Aponte para **scripts** relativos quando necessário

## Com Scripts Auxiliares

```
skills/minha-skill/
├── SKILL.md
└── scripts/
    ├── setup.sh
    └── validate.mjs
```

No SKILL.md, referencie scripts com caminhos relativos:

```markdown
## Setup
\`\`\`bash
./scripts/setup.sh
\`\`\`
```

Se os scripts têm dependências npm, inclua `package.json` na pasta de scripts.

## Onde Colocar

| Escopo | Localização |
|---|---|
| Projeto | `.pi/skills/minha-skill/SKILL.md` |
| Global | `~/.pi/agent/skills/minha-skill/SKILL.md` |
| Pacote | `skills/minha-skill/SKILL.md` (com `pi.skills` no `package.json`) |

## Empacotando como npm

```json
{
  "name": "@aretw0/minha-skill",
  "keywords": ["pi-package"],
  "pi": {
    "skills": ["./skills"]
  }
}
```

Publicar:

```bash
npm publish --access public
```

Instalar:

```bash
pi install npm:@aretw0/minha-skill
```

## Heurística: Skill vs Extension

| Precisa de... | Use |
|---|---|
| Instruções recorrentes | Skill |
| Exemplos de uso de CLI | Skill |
| Templates de código | Skill |
| Hooks no ciclo de vida do pi | Extension |
| Tools customizadas para o LLM | Extension |
| UI no TUI (widgets, footers) | Extension |
| Persistência de estado | Extension |
