# Modelo de escopo de runtime do pi (global vs projeto vs isolado)

**Data:** 2026-04-22  
**Objetivo:** remover ambiguidade operacional sobre *onde* o pi está rodando e *onde* aplicar mudanças sem overengineering.

## Resumo executivo

No agents-lab, trate os escopos assim:

1. **Global (usuário/máquina)**  
   Runtime padrão usando `~/.pi/agent` e instalação global do CLI.
2. **Projeto (workspace local)**  
   Configuração canônica versionada em `./.pi/settings.json` e código da stack em `packages/*`.
3. **Isolado (sandbox de desenvolvimento)**  
   Mesmo workspace, mas com `PI_CODING_AGENT_DIR=.sandbox/pi-agent` (via `npm run pi:isolated`) para evitar drift de `~/.pi/agent`.

## Como o pi resolve settings/pacotes em cada modo (com exemplos)

| Modo | Estado de sessão principal | Como ativar | Exemplo prático |
|---|---|---|---|
| Global | `~/.pi/agent/*` | `pi` direto no terminal | bom para uso diário fora do monorepo |
| Projeto | `./.pi/settings.json` (governança do repo) | abrir sessão no workspace e usar stack local | ideal para evoluir `@aretw0/pi-stack` |
| Isolado | `.sandbox/pi-agent/*` + workspace local | `npm run pi:isolated` | ideal para debug/reprodução sem contaminar estado global |

### Exemplo A — Global

- Você roda `pi` em qualquer pasta.
- Sessões/auth/settings tendem a cair no diretório de usuário (`~/.pi/agent`).
- Use para operação comum, não para experimento de runtime da stack do repo.

### Exemplo B — Projeto

- Você está no repositório `agents-lab`.
- A governança canônica é o que está em `./.pi/settings.json` + `.project/*`.
- Mudanças devem ir para `packages/pi-stack/**` (fonte), não para artefato de runtime global.

### Exemplo C — Isolado

- Você roda `npm run pi:isolated`.
- O launcher define `PI_CODING_AGENT_DIR` para `.sandbox/pi-agent`.
- Resultado: settings/sessions do experimento ficam locais ao repo, com menor risco de drift global.

## Fluxo operacional: onde alterar cada coisa

### 1) Alterar `node_modules` global

**Evite por padrão.** Só considerar em diagnóstico rápido de ambiente local (não canônico), e nunca como entrega final.

Use quando:
- o problema é estritamente de instalação global quebrada do usuário;
- você quer confirmar hipótese de runtime, sabendo que depois vai portar para código fonte.

### 2) Alterar workspace local (canônico)

**Padrão recomendado.**

Use quando:
- a mudança é parte da evolução real da stack;
- você precisa commit/versionamento/revisão;
- quer resultado reprodutível em CI/outros devs.

Superfícies típicas:
- `packages/pi-stack/extensions/**`
- `packages/pi-stack/test/**`
- `docs/**`
- `.project/**`

### 3) Alterar package da stack (fonte)

Quando a mudança é de produto (skill/extension/adapter), altere **direto no source package** do monorepo e valide por teste/smoke.

## Checklist rápido para não editar no lugar errado

> Rode este checklist antes de qualquer alteração de runtime.

1. **Estou no repo certo?**
   - `pwd`
   - `git rev-parse --show-toplevel`

2. **Estou em modo isolado ou global?**
   - `npm run pi:isolated:status`
   - verificar linha `active mode` (`isolated ✅` ou `default/global`)

3. **Qual PI_CODING_AGENT_DIR está ativo?**
   - no shell: `echo $PI_CODING_AGENT_DIR` (ou equivalente no PowerShell)

4. **A mudança é canônica?**
   - Se sim: editar `packages/**`, `docs/**`, `.project/**`.
   - Se não: tratar como experimento temporário, sem confundir com entrega final.

5. **Estou evitando patch em build/dist externo?**
   - não usar `node_modules` global como fonte de verdade.

## Anti-overengineering (regra prática)

- Se já existe primitiva canônica local (ex.: `.project`, `packages/pi-stack`), **estenda ela**.
- Não crie camada paralela só para “organizar” sem necessidade operacional.
- Preferir micro-slice com evidência objetiva (1 mudança + 1 validação) a refactor amplo multi-escopo.

## Conclusão

Para o agents-lab, a estratégia segura é:
- operar diariamente com clareza de escopo (global/projeto/isolado),
- desenvolver no **source do workspace**,
- usar o **modo isolado** para reproduzir/runtime-debug sem contaminar `~/.pi/agent`,
- manter board canônico e verificação explícita como trilha de verdade.
