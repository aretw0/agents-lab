# @aretw0/pi-skills

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
