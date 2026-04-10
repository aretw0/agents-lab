---
name: terminal-setup
description: >
  Diagnóstico e configuração de terminal para pi. Use quando o usuário tiver
  problemas com Shift+Enter, keybindings, ou ao configurar um terminal novo.
---

# Terminal Setup

Ajuda o usuário a configurar o terminal para funcionar corretamente com o pi.

Pi usa o [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/). Terminais que não suportam esse protocolo têm limitações com `Shift+Enter`, `Alt+Enter` e outros atalhos.

## Diagnóstico

Se `Shift+Enter` não insere nova linha, pergunte ao usuário qual terminal usa e aplique a config correspondente.

## Configurações por Terminal

### Windows Terminal

O usuário precisa adicionar ao `settings.json` (`Ctrl+Shift+,`):

```json
{
  "actions": [
    {
      "command": { "action": "sendInput", "input": "\u001b[13;2u" },
      "keys": "shift+enter"
    },
    {
      "command": { "action": "sendInput", "input": "\u001b[13;3u" },
      "keys": "alt+enter"
    }
  ]
}
```

Diga ao usuário para fechar e reabrir completamente o Windows Terminal após salvar.

### Ghostty

Adicionar ao config (`~/.config/ghostty/config` no Linux, `~/Library/Application Support/com.mitchellh.ghostty/config` no macOS):

```
keybind = alt+backspace=text:\x1b\x7f
```

Se o usuário tem `keybind = shift+enter=text:\n` (legado do Claude Code), oriente a remover — causa conflito com `Ctrl+J` no pi.

### WezTerm

Criar `~/.wezterm.lua`:

```lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()
config.enable_kitty_keyboard = true
return config
```

### VS Code Terminal

Adicionar ao `keybindings.json`:

```json
{
  "key": "shift+enter",
  "command": "workbench.action.terminal.sendSequence",
  "args": { "text": "\u001b[13;2u" },
  "when": "terminalFocus"
}
```

Paths do `keybindings.json`:
- macOS: `~/Library/Application Support/Code/User/keybindings.json`
- Linux: `~/.config/Code/User/keybindings.json`
- Windows: `%APPDATA%\Code\User\keybindings.json`

### Terminais com suporte nativo

Kitty e iTerm2 funcionam sem configuração adicional.

### Terminais não recomendados

xfce4-terminal, terminator e IntelliJ Terminal não conseguem distinguir `Shift+Enter` de `Enter`.

## Windows — Shell Path

Pi precisa de bash no Windows. Verificar com:

```bash
git --version
```

Se Git Bash não está instalado, orientar o download: https://git-scm.com/download/win

Para path customizado, editar `~/.pi/agent/settings.json`:

```json
{
  "shellPath": "C:\\caminho\\para\\bash.exe"
}
```

## Keybindings Customizados

Arquivo: `~/.pi/agent/keybindings.json`

Exemplo — aceitar `Ctrl+J` como nova linha:
```json
{
  "tui.input.newLine": ["shift+enter", "ctrl+j"]
}
```

Após editar: `/reload` no pi.
