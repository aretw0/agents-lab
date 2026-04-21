# Dogfood unificado (TUI + WEB) em isolamento

Objetivo: recriar um ambiente próximo do usuário final, com runtime isolado no workspace, mantendo TUI e superfície WEB observável sem drift de configuração global.

## Quando usar

- antes de validar mudança sensível de governança/monitoria;
- antes de promover slice para release candidate;
- quando quiser reproduzir fluxo do usuário com sessão longa + observabilidade web.

## Pré-voo (2-3 min)

```bash
npm run pi:isolated:status
npm run context:preload
```

Opcional (puxar sessão mais recente do global para sandbox local):

```bash
npm run pi:isolated:adopt-latest
```

## Subir sessão isolada

```bash
npm run pi:isolated
```

Dentro do Pi (na sessão isolada):

1. Iniciar gateway web local:
   - `/session-web start`
   - `/session-web status`
2. Confirmar gates operacionais:
   - `/colony-pilot preflight`
   - `/subagent-readiness` (ou tool `subagent_readiness_status`)
   - `context_watch_status`
3. Se precisar abrir dashboard no browser:
   - `/session-web open`

## Modo de operação (dual/mirror)

Escolha explicitamente uma trilha:

1. **`.project-first`**: canônico no workspace.
2. **adapter-first**: operar no sistema do usuário (Markdown/DB/API/web automation).
3. **canônico + espelho humano**: `.project` oficial + projeção Markdown (ex.: `vault-seed`).

## Evidência mínima por rodada

- estado de gate (`preflight`, `readiness`, `context-watch`);
- modo escolhido (`.project-first` / adapter-first / mirror);
- ação aplicada + verificação canônica em `.project/verification`.

## Trilha futura: devcontainer opcional

A estratégia de isolamento deste guia será espelhada em devcontainer (Docker Desktop + VS Code) para onboarding mínimo, mantendo os mesmos invariantes de runtime local.

Referência de planejamento: `docs/research/devcontainer-blueprint-2026-04-21.md`.

## Regras de segurança operacional

- sem publish direto a partir de rodada de dogfood;
- usar commits atômicos por micro-slice;
- checkpoint curto em janela de contexto alta (65-68%).
