# Compatibilidade de Plataforma do Pi

## Resumo

Pi é multiplataforma. Funciona em macOS, Linux, Windows e até Termux (Android). A instalação base é a mesma em todos os sistemas:

```bash
npm install -g @earendil-works/pi-coding-agent
```

O que muda entre plataformas são as dependências de shell e alguns atalhos de teclado.

## Windows

Pi no Windows requer um shell bash. Na inicialização, o Pi procura nesta ordem:

1. Caminho customizado em `~/.pi/agent/settings.json` (campo `shellPath`)
2. Git Bash (`C:\Program Files\Git\bin\bash.exe`)
3. `bash.exe` no PATH (Cygwin, MSYS2, WSL)

Para a maioria dos usuários, [Git for Windows](https://git-scm.com/download/win) é suficiente.

### Configuração customizada de shell

```json
{
  "shellPath": "C:\\cygwin64\\bin\\bash.exe"
}
```

### Diferenças de atalhos no Windows

| Ação | macOS/Linux | Windows |
|------|-------------|---------|
| Multi-line no editor | Shift+Enter | Ctrl+Enter (Windows Terminal) |
| Colar imagem | Ctrl+V | Alt+V |
| Follow-up message | Alt+Enter | Precisa remapear (Alt+Enter é fullscreen no Windows Terminal) |

Para configurar o terminal, consultar o [guia oficial de terminal setup](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/terminal-setup.md).

## macOS e Linux

Funcionam nativamente sem configuração extra. Bash é o shell padrão e todos os atalhos funcionam como documentado.

## Termux (Android)

Pi tem suporte oficial para Termux. Consultar a [documentação dedicada](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/termux.md).

## Devcontainer

O devcontainer é caminho suportado para desenvolvimento do agents-lab e para usuários que querem uma sandbox Linux reprodutível sem depender do estado global do host.

Contrato atual:

- Node.js 24 no devcontainer;
- compatibilidade de pacote mantida em Node.js >=22;
- bash, Git, GitHub CLI e toolchain de build;
- Ruby/Bundler para o site Jekyll;
- locale `pt_BR.UTF-8` com fallback prático para inglês;
- volumes persistentes para caches e homes de ferramentas;
- `PI_CODING_AGENT_DIR` isolado no workspace;
- comando `lab` para entrar no workspace correto a partir de terminais abertos no root do container.

O devcontainer não substitui o uso nativo do Pi no Windows. Ele é a opção recomendada quando o trabalho precisa de paridade Linux, caches preservados entre rebuilds ou isolamento mais forte para agentes.

### Recursos

O container do agents-lab limita o uso de recursos por padrão para manter espaço para outros projetos:

- `--memory=3g`
- `--cpus=3`
- host recomendado: 2 CPUs e 4 GB de RAM

Projetos consumidores podem ajustar esses limites conforme a máquina e o tipo de trabalho. A recomendação é aumentar só quando houver evidência de gargalo.

### Persistência

O devcontainer deve preservar caches e estado de ferramentas entre rebuilds por volumes nomeados. No agents-lab, isso inclui:

- `node_modules`
- cache npm/pnpm
- home Pi (`~/.pi`)
- home Claude (`~/.claude`)
- home Codex (`~/.codex`)
- config GitHub CLI (`~/.config/gh`)

Essa política evita logins e caches descartados a cada rebuild sem versionar credenciais no repositório.

## Referências

- [Docs oficiais — Windows](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/windows.md)
- [Docs oficiais — Terminal Setup](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/terminal-setup.md)
- [Docs oficiais — Termux](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/termux.md)
