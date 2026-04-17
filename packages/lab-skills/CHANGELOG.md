# @aretw0/lab-skills

## 0.7.0

## 0.6.0

## 0.5.0

## 0.4.2

## 0.4.1

## 0.4.0

## 0.3.10

## 0.3.9

## 0.3.8

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
