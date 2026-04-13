# @aretw0/pi-stack

## 0.3.9

### Patch Changes

- Refina o fluxo de desenvolvimento do pi-stack para o modelo pós-"guarda-chuva":

  - remove o package-lock legado de packages/pi-stack
  - atualiza smoke tests para resolver dependências third-party com prioridade em node_modules da raiz (fallback para node_modules local do pacote)
  - reduz drift entre ambiente local e setup de workspaces, mantendo a cobertura de curadoria e filtros

## 0.3.8

### Patch Changes

- Update monitor defaults for davidorex compatibility:

  - switch monitor-provider-patch classifier overrides from claude-sonnet to claude-haiku
  - set classifier thinking to off by default
  - make hedge monitor conversation_history opt-in via settings
  - apply sane defaults on session_start for already initialized workspaces
  - document the new defaults in pi-stack docs

## 0.2.1

### Patch Changes

- ### @aretw0/pi-stack

  Sincroniza commits que ficaram fora da tag v0.2.0:

  - Extension `environment-doctor`: detecção e auto-fix de configuração de terminal (shift+enter / alt+enter para Windows Terminal, Ghostty, WezTerm, VS Code)
  - Extension `read-guard`: proteção de leitura fora do diretório do projeto
  - Tema `agents-lab` incluído no manifesto pi
  - Fix: JSON inválido no manifesto pi — duplicata de `themes` removida

## 0.2.0

### Minor Changes

- ### @aretw0/pi-stack

  - Extension `monitor-provider-patch`: fix automático de classifiers para github-copilot — detecta provider na session_start e cria overrides em `.pi/agents/` se ausentes (14 testes)
  - Manifesto `pi` na raiz para instalação via `pi install https://github.com/aretw0/agents-lab`

  ### @aretw0/pi-skills (novo)

  Skills de fábrica para criar e configurar o ecossistema pi:

  - `terminal-setup` — diagnóstico e configuração de terminal (Windows Terminal, Ghostty, WezTerm, VS Code)
  - `create-pi-skill` — como criar skills com empacotamento npm
  - `create-pi-extension` — como criar extensões TypeScript com tools, commands e eventos
  - `create-pi-theme` — como criar temas visuais
  - `create-pi-prompt` — como criar prompt templates com argumentos

  ### @aretw0/lab-skills (novo)

  Skills experimentais para cultivo de primitivas e curadoria:

  - `evaluate-extension` — scorecard estruturado para avaliar extensões (anti-slop)
  - `cultivate-primitive` — guia de cultivo da identificação ao pacote publicado
  - `stack-feedback` — coleta feedback estruturado sobre a stack via issues GitHub
