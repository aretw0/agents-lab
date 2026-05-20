---
title: Terminal Setup
description: Terminal setup guidance for Pi and operator workflows.
---

# Configuração de Terminal para Pi

Guia de setup por terminal para garantir que o pi funcione corretamente — teclado, atalhos e compatibilidade.

Pi usa o [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) para detecção confiável de modificadores. Terminais que não suportam esse protocolo têm limitações em atalhos como `Shift+Enter` e `Alt+Enter`.

---

## Terminais Recomendados

| Terminal | Suporte | Observação |
|---|---|---|
| [Ghostty](https://ghostty.org/) | ✅ Nativo | Requer uma config (ver abaixo) |
| [WezTerm](https://wezfurlong.org/wezterm/) | ✅ Com config | Uma linha no `wezterm.lua` |
| [Kitty](https://sw.kovidgoyal.net/kitty/) | ✅ Nativo | Funciona out of the box |
| [iTerm2](https://iterm2.com/) | ✅ Nativo | Funciona out of the box |
| Windows Terminal | ✅ Com config | Requer remapping de teclas |
| VS Code Terminal | ⚠️ Parcial | `Shift+Enter` requer config |
| IntelliJ Terminal | ⚠️ Limitado | `Shift+Enter` indistinguível de `Enter` |
| xfce4-terminal / terminator | ❌ Limitado | Modified Enter keys não funcionam |

---

## Windows Terminal

O mais comum no Windows. Requer remapping de duas teclas no `settings.json`.

**Abrir:** `Ctrl+Shift+,` → ou Settings → Open JSON file

Adicionar ao array `actions`:

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

- `Shift+Enter` → nova linha no editor do pi
- `Alt+Enter` → desfaz o binding padrão de fullscreen e encaminha o chord real para o pi

Após salvar, fechar e reabrir completamente o Windows Terminal se o fullscreen persistir.

---

## Ghostty

```
# ~/.config/ghostty/config (Linux)
# ~/Library/Application Support/com.mitchellh.ghostty/config (macOS)

keybind = alt+backspace=text:\x1b\x7f
```

> **Atenção:** Se você adicionou `keybind = shift+enter=text:\n` por causa do Claude Code antigo, remova. Esse mapping torna `Shift+Enter` indistinguível de `Ctrl+J` dentro do pi. Se precisar dos dois, adicione `ctrl+j` ao keybinding `newLine` do pi (ver seção Keybindings abaixo).

---

## WezTerm

```lua
-- ~/.wezterm.lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()
config.enable_kitty_keyboard = true
return config
```

---

## VS Code (Terminal Integrado)

Adicionar ao `keybindings.json`:

- **macOS:** `~/Library/Application Support/Code/User/keybindings.json`
- **Linux:** `~/.config/Code/User/keybindings.json`
- **Windows:** `%APPDATA%\Code\User\keybindings.json`

```json
{
  "key": "shift+enter",
  "command": "workbench.action.terminal.sendSequence",
  "args": { "text": "\u001b[13;2u" },
  "when": "terminalFocus"
}
```

---

## Windows — Shell Path

Pi precisa de um shell bash no Windows. Ordem de busca:

1. `shellPath` customizado em `~/.pi/agent/settings.json`
2. Git Bash (`C:\Program Files\Git\bin\bash.exe`)
3. `bash.exe` no PATH (Cygwin, MSYS2, WSL)

Para Git for Windows (recomendado): [git-scm.com/download/win](https://git-scm.com/download/win)

Para path customizado:

```json
{
  "shellPath": "C:\\cygwin64\\bin\\bash.exe"
}
```

---

## Keybindings Customizados

Arquivo: `~/.pi/agent/keybindings.json`

Aplicar mudanças sem reiniciar: `/reload`

### Exemplo: aceitar `Ctrl+J` como nova linha (útil com Ghostty + tmux)

```json
{
  "tui.input.newLine": ["shift+enter", "ctrl+j"]
}
```

### Exemplo: submit com `Ctrl+Enter` em vez de `Enter`

```json
{
  "tui.input.submit": ["ctrl+enter"],
  "tui.input.newLine": ["enter", "shift+enter"]
}
```

---

## Diagnóstico Rápido

Se `Shift+Enter` não insere nova linha:
1. Confirmar que o terminal tem suporte ao Kitty keyboard protocol
2. Aplicar a config específica do terminal (seções acima)
3. Reiniciar completamente o terminal após a config

Se os monitors (hedge, fragility etc.) não aparecem:
→ Ver [`monitor-overrides.md`](./monitor-overrides.md)

Se o pi não inicia no Windows:
→ Confirmar que Git Bash está instalado ou configurar `shellPath`
