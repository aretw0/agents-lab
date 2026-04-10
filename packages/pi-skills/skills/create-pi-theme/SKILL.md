---
name: create-pi-theme
description: >
  Como criar um tema visual para o TUI do pi. Use quando o usuário quiser
  personalizar cores e aparência do terminal.
---

# Criando um Tema Pi

Temas são arquivos JSON que definem as cores do TUI do pi.

## Estrutura

```json
{
  "name": "meu-tema",
  "colors": {
    "accent": "#ff6b6b",
    "success": "#51cf66",
    "error": "#ff6b6b",
    "warning": "#fcc419",
    "muted": "#868e96",
    "dim": "#495057",
    "toolTitle": "#74c0fc",
    "border": "#495057",
    "bg": "#1a1b26",
    "fg": "#c9d1d9"
  }
}
```

## Onde Colocar

| Escopo | Localização |
|---|---|
| Global | `~/.pi/agent/themes/meu-tema.json` |
| Projeto | `.pi/themes/meu-tema.json` |
| Pacote | `themes/meu-tema.json` (com `pi.themes` no `package.json`) |

## Ativar

```bash
/settings
# Selecionar tema
```

Ou via settings:
```json
{
  "theme": "meu-tema"
}
```

## Empacotando

```json
{
  "name": "@aretw0/meu-tema",
  "keywords": ["pi-package"],
  "pi": {
    "themes": ["./themes"]
  }
}
```

## Referência

Cores disponíveis: `accent`, `success`, `error`, `warning`, `muted`, `dim`, `toolTitle`, `border`, `bg`, `fg`.

Use nomes de cores hex. O pi aplica as cores automaticamente em todo o TUI.

Ver temas existentes em `@ifi/oh-pi-themes` como referência de paletas testadas.
