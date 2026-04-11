# Compatibilidade de Plataforma do Pi

## Resumo

Pi é multiplataforma. Funciona em macOS, Linux, Windows e até Termux (Android). A instalação base é a mesma em todos os sistemas:

```bash
npm install -g @mariozechner/pi-coding-agent
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

## DevContainer — Precisamos de um?

### Situação atual

Estamos no Windows com Git for Windows instalado. Pi funciona nativamente neste cenário.

### Argumentos a favor de um DevContainer

- **Ambiente consistente**: bash nativo sem camada de tradução (Git Bash)
- **Reprodutibilidade**: qualquer colaborador monta o mesmo ambiente com um clique
- **Isolamento**: evita poluir o sistema global com dependências de Pi e pacotes npm
- **Toolchain completa**: tree-sitter, ast-grep, LSP servers e outras dependências de pi-lens funcionam melhor em Linux nativo
- **CI/CD**: o mesmo container pode ser usado em pipelines

### Argumentos contra (por enquanto)

- **Overhead prematuro**: estamos em fase de pesquisa, não de produção
- **Pi funciona no Windows**: Git Bash é suficiente para validar a stack
- **Manutenção**: devcontainer precisa ser mantido junto com o projeto

### Decisão

**Fase atual**: usar Pi nativo no Windows. Git Bash é suficiente para bootstrap e validação.

**Futuro**: criar devcontainer quando:

1. entrarmos em desenvolvimento de extensões in-house (Fase 2-3)
2. precisarmos de toolchain pesada (tree-sitter, ast-grep, multiple LSPs)
3. tivermos mais de um colaborador ativo

### Esboço do DevContainer futuro

Quando chegar a hora, o `.devcontainer/devcontainer.json` deve incluir:

- Node.js 20+
- Pi coding agent pré-instalado
- Stack mínima (`oh-pi`, `pi-project-workflows`, `pi-web-access`, `pi-lens`)
- Git e ferramentas de desenvolvimento
- Variáveis de ambiente para provider(s) de LLM

## Referências

- [Docs oficiais — Windows](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/windows.md)
- [Docs oficiais — Terminal Setup](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/terminal-setup.md)
- [Docs oficiais — Termux](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/termux.md)
