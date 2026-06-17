---
title: Devcontainer Factory Contract
description: Minimal devcontainer contract for operator and agent work.
---

# Devcontainer Factory Contract

Contrato mínimo para operar um projeto com agentes em devcontainer sem depender
do estado do host. Use este guia como checklist antes de portar aprendizados para
`refarm`, `vault-seed` ou outro projeto que precise da mesma cadência.

## Contrato

1. O devcontainer é a superfície canônica de validação.
   - Rode gates Linux dentro do container.
   - Não dependa de WSL local para `bash`, paths ou permissões.
   - No host, use apenas comandos de orquestração (`docker`, VS Code, Git).

2. O wrapper de entrada é parte da fábrica.
   - Deve funcionar para operador e agente.
   - Deve oferecer modo headless sem pseudo-TTY para agentes e canários.
   - Deve corrigir `HOME`, `USER`, locale, workdir e PATH.
   - Deve incluir `node_modules/.bin`, `PNPM_HOME`, npm global e CLIs locais.
   - Deve funcionar quando chamado como `root` e quando já estiver no usuário alvo.

3. Caches e memórias não versionáveis precisam sobreviver a rebuild.
   - `node_modules` pode ser volume se o projeto aceitar isso.
   - pnpm store, npm cache e npm global devem ser volumes separados.
   - Homes de assistentes (`.pi`, `.codex`, `.claude`) devem ser volumes quando o
     projeto instala ou incentiva essas CLIs.

4. O CI precisa ter primitives first-party.
   - Setup Node/pnpm deve morar em `.github/actions/setup`.
   - Workflows consomem a action local em vez de duplicar `setup-node` e install.
   - O checker de pins deve cobrir `.github/workflows` e `.github/actions`.
   - Permissões de escrita ficam no job que precisa delas, não no workflow inteiro.

5. O contrato precisa ter testes.
   - Teste o wrapper e os lifecycle scripts como texto versionado.
   - Teste workflow/action pins e permissões.
   - Teste que release/publish continuam preservando registry/provenance quando
     passam pela action compartilhada.

## Diagnóstico De Namespace

O post-start do `agents-lab` verifica se `bubblewrap` está instalado e consegue
criar namespaces com `bwrap --ro-bind / / true`. Se o host ou o runtime do
container negar namespaces sem privilégio, o log esperado é:

```text
[agents-lab-devcontainer][warn] bubblewrap is installed but cannot create namespaces.
[agents-lab-devcontainer][warn] Host/container policy denies unprivileged namespaces; devcontainer stays usable, but bwrap isolation is unavailable.
[agents-lab-devcontainer][warn] Rebuild/reopen the devcontainer, or enable unprivileged user namespaces on the host.
```

Interpretação operacional:

- `bubblewrap` foi instalado pela imagem, então não é falta de pacote.
- O devcontainer continua válido para desenvolvimento, docs, testes e comandos
  `lab pi`.
- A sandbox forte baseada em namespace não deve ser assumida enquanto o warning
  persistir.
- Primeiro tente rebuild/reopen para aplicar `runArgs` e lifecycle scripts.
- Se persistir, a correção é no host ou no runtime Docker: habilitar
  unprivileged user namespaces ou executar em um ambiente Linux/container que
  permita essa primitiva.

Não silencie esse aviso sem registrar evidência de que `bwrap --ro-bind / /
true` passou no ambiente corrente.

## Checklist De Portabilidade

Antes de aplicar este contrato em outro repositório:

- [ ] Identificar usuário alvo do container (`vscode`, `node` ou outro).
- [ ] Definir comando de entrada do projeto (`lab`, `farm`, etc.).
- [ ] Mapear CLIs que precisam estar prontas no rebuild.
- [ ] Separar o que deve ser instalado no container do que deve ser cache/volume.
- [ ] Confirmar se o projeto precisa de pnpm, npm, cargo, turbo ou Playwright.
- [ ] Criar ou revisar `.github/actions/setup`.
- [ ] Mover permissões GitHub Actions para job-level quando possível.
- [ ] Rodar o gate canônico dentro do devcontainer.
- [ ] Rodar `agent-run:driver-canaries:container` com `--container <nome>` quando houver devcontainer ativo para provar o driver headless antes de fan-out.

## Prompt De Handoff

Use este prompt quando abrir um agente em outro repositório:

```text
Revise a fábrica devcontainer/CI deste repositório usando o contrato de
agents-lab em docs/guides/devcontainer-factory-contract.md como referência.

Objetivo:
- manter o devcontainer como superfície canônica de validação;
- garantir wrapper de entrada para operador e agente;
- preservar caches e memórias não versionáveis entre rebuilds;
- centralizar setup Node/pnpm em action first-party;
- reduzir permissões de GitHub Actions ao menor escopo;
- adicionar testes que travem esses contratos.

Restrições:
- não importar complexidade que o projeto não usa;
- não mexer em credenciais;
- não apagar caches/sessões sem confirmação;
- preservar mudanças locais não relacionadas.

Entregue commits pequenos, com validação local e explicação das diferenças
entre o contrato do agents-lab e as necessidades reais deste repositório.
```

## Evidência Atual No agents-lab

- `pnpm run ci:local:parity` passou dentro do devcontainer.
- `162` arquivos Vitest passaram, com `1329` testes.
- Gates de soberania, complexidade e bloat passaram.
- O wrapper `lab` expõe `pi`, `codex`, `claude` e `pnpm` como usuário `vscode`.
