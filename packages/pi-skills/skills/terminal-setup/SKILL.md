---
name: terminal-setup
description: >
  Diagnostico e configuracao de terminal para pi. Use quando o usuario tiver
  problemas com Shift+Enter, keybindings, shell errado, ou ao configurar um terminal novo.
---

# Terminal Setup

Ajuda o usuario a configurar o terminal para funcionar corretamente com o pi.

Pi usa o [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/). Terminais que nao suportam esse protocolo tem limitacoes com `Shift+Enter`, `Alt+Enter` e outros atalhos.

## Diagnostico

Se `Shift+Enter` nao insere nova linha, pergunte ao usuario qual terminal usa e aplique a config correspondente.

Se o pi parece usar o shell errado (ex: WSL em vez de Git Bash), veja a secao "Windows -- Shell Path".

## Configuracoes por Terminal

### Windows Terminal

O usuario precisa adicionar ao `settings.json` (`Ctrl+Shift+,`):

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

Diga ao usuario para fechar e reabrir completamente o Windows Terminal apos salvar.

### Ghostty

Adicionar ao config (`~/.config/ghostty/config` no Linux, `~/Library/Application Support/com.mitchellh.ghostty/config` no macOS):

```
keybind = alt+backspace=text:\x1b\x7f
```

Se o usuario tem `keybind = shift+enter=text:\n` (legado do Claude Code), oriente a remover -- causa conflito com `Ctrl+J` no pi.

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

Kitty e iTerm2 funcionam sem configuracao adicional.

### Terminais nao recomendados

xfce4-terminal, terminator e IntelliJ Terminal nao conseguem distinguir `Shift+Enter` de `Enter`.

## Windows -- Shell Path

Pi precisa de bash no Windows. Existem dois cenarios comuns:

### Git Bash (recomendado)

Verificar se Git Bash esta instalado:

```bash
git --version
```

Se nao esta instalado: https://git-scm.com/download/win

### WSL instalado junto com Git Bash

Quando WSL e Git Bash coexistem, o pi pode resolver `/usr/bin/bash` (WSL)
em vez do Git Bash. Sintomas:
- `node` e `npm` nao encontrados no PATH
- Rede instavel (WSL tem stack de rede separado do Windows)
- Paths aparecem como `/mnt/c/...` em vez de `/c/...`
- Ferramentas do Windows (gh, git credential manager) nao funcionam

**Diagnostico rapido** -- rodar no pi:

```bash
uname -a
```

Se mostrar `Linux ... microsoft-standard-WSL2`, o pi esta usando WSL.

**Fix:** Adicionar ao `~/.pi/agent/settings.json`:

```json
{
  "shellPath": "C:\\Program Files\\Git\\bin\\bash.exe"
}
```

Depois rode `/reload` no pi.

**Importante:** `shellPath` e configuracao pessoal do usuario, nao do projeto.
Pacotes e extensoes nunca devem alterar essa configuracao -- apenas diagnosticar
e instruir o usuario.

Se o pi-stack esta instalado, `/doctor` detecta esse cenario automaticamente.

## Keybindings Customizados

Arquivo: `~/.pi/agent/keybindings.json`

Exemplo -- aceitar `Ctrl+J` como nova linha:
```json
{
  "tui.input.newLine": ["shift+enter", "ctrl+j"]
}
```

Apos editar: `/reload` no pi.
