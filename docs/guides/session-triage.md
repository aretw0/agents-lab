# Session Triage (recente) — histórico -> backlog executável

Este guia transforma conversas recentes do pi (incluindo branch summaries) em pendências claras no board canônico (`.project/tasks`).

## Quando usar

- Sensação de "já foi tudo dito" no chat
- Muitas sessões/branches em paralelo
- Necessidade de separar **destravar swarm agora** vs **estabilizar depois**

## Escolha de modo (2 min)

Antes de rodar triagem, escolha o modo de operação:

1. **`.project-first`**
   - canônico local no workspace;
   - melhor para governança integrada.

2. **adapter-first**
   - manter sistema atual do usuário (Markdown/Obsidian, DB/API, automação/web);
   - triagem continua útil para organizar backlog, sem migração forçada.

3. **canônico + espelho humano (opt-in)**
   - `.project` segue oficial;
   - projeção para vault Markdown renderizável (referência: https://github.com/aretw0/vault-seed).

Checklist de spawn rápido por modo:
- `npm run context:preload` para sugerir carga mínima recente;
- coordenador carrega `control-plane-core`;
- workers carregam `agent-worker-lean`.

## Comando principal

```bash
npm run session:triage
```

Padrão atual de coleta (context-economy):
- **local-first**: `.sandbox/pi-agent/sessions/<workspaceKey>`
- **tail-batch**: lê só a cauda da sessão por janela, em vez de scan completo
- fallback global só com `--allow-global-fallback`

JSON (para automação):

```bash
npm run session:triage:json
```

Fonte canônica adicional (provider-agnostic):

```bash
node scripts/session-triage.mjs --events ./data/canonical-events.json
```

Também aceita JSONL (um evento por linha):

```bash
node scripts/session-triage.mjs --events ./data/canonical-events.jsonl
```

Exemplo no repositório:

```bash
node scripts/session-triage.mjs --events docs/research/data/session-triage/canonical-events.example.json
```

Atalhos npm para smoke do adapter canônico:

```bash
npm run session:triage:events:json
npm run session:triage:events:jsonl
```

Por padrão, o script lê **último 1 dia** e até **8 sessões** mais recentes, usando tail-batch.

Flags úteis de janela progressiva:

```bash
# janela base (cauda curta)
node scripts/session-triage.mjs --tail-lines 160 --window 1

# ampliar sem scan completo direto
node scripts/session-triage.mjs --tail-lines 200 --window 2
node scripts/session-triage.mjs --tail-lines 200 --expand

# fallback para store global (somente quando explicitamente desejado)
node scripts/session-triage.mjs --allow-global-fallback
```

Também mantém um cache parseável de branch summaries em:

- `.sandbox/pi-agent/triage/branch-summary-store.json`

Esse store é atualizado automaticamente com summaries detectados (sessões + fonte canônica), para evitar depender de cópia manual quando um resumo de branch saiu da janela curta.

Flags úteis:

```bash
# usar caminho explícito
node scripts/session-triage.mjs --summary-store ./.sandbox/pi-agent/triage/branch-summary-store.json

# desativar persistência local
node scripts/session-triage.mjs --no-summary-store
```

## O que o script entrega

> Estado atual: implementação inicial focada em sessões locais do pi.
> Direção oficial: evoluir para ingestão provider-agnostic (Telegram/WhatsApp/Matrix/Signal etc.) via adapter canônico, sem mudar a governança do board.

- sessões recentes e sinais de colônia (`COLONY_SIGNAL:*`)
- agregação por provider da fonte de eventos (ex.: `pi`, `telegram`, `matrix`, `custom`)
- agregação de branch summaries (`Next Steps`, `In Progress`, `Blocked`), incluindo os persistidos no store local parseável
- split de pendências do board:
  - **Unlock swarm now** (P0/promotion/bloqueios)
  - **Later stabilization** (restante)
- detecção de **tooling/capability gaps** com candidatos de claim (`toolingClaims`) para bootstrap/permissão antes de execução principal
- recomendação de **delegation lane** (`recommendation`) para escalar com pragmatismo: `bootstrap-first` -> `subagent-as-tool` -> `swarm-candidate`

Contrato canônico de eventos (v1):
- [`docs/primitives/conversation-event-canonical-schema.md`](../primitives/conversation-event-canonical-schema.md)

## Loop operacional estendido (15-30 min, em controle)

Use quando quiser avançar mais de um micro-lote sem perder governança:

1. Rodar triagem (`npm run session:triage`) e escolher **1 frente ativa**.
2. Rodar gate rápido de control plane:
   - `scheduler_governance_status`
   - `colony_pilot_preflight`
   - `context_watch_status`
   - `subagent_readiness_status(strict=true)`
3. Classificar a rodada em `GO`, `GO condicional` ou `NO-GO`.
4. Executar lote curto (1 objetivo), registrar evidência e atualizar `.project`.
5. Repetir o gate antes do próximo lote.

Política prática para comandos longos:
- comandos curtos/críticos (status, diff, commit): foreground com timeout explícito;
- jobs longos: background intencional com PID/log + checkpoint após conclusão.

Patrol recorrente (soft intent) é opcional para sessões long-run:
- use scheduler prompt para cadência de observação;
- mantenha decisão operacional em gates hard (GO/GO condicional/NO-GO).

## Capability gap claim (primitiva operacional)

Quando a triagem mostrar blockers recorrentes como `command-not-found`, `ENOENT`, `missing capabilities/executables` ou `Instructions are required`:

1. registrar claim de capability gap (com recomendação de ação);
2. remediar bootstrap/permissão primeiro;
3. só então iniciar lote autônomo principal.

Se a saída `recommendation.lane` vier como:
- `bootstrap-first`: resolver claims antes de delegar;
- `subagent-as-tool`/`subagent-warmup`: delegar micro-slice curto;
- `swarm-candidate`: rodar gate strict e considerar swarm com budget explícito.

Referência da primitiva: `docs/primitives/capability-gap-claim.md`.

## Governança

- `.project/tasks` continua clock oficial
- sem auto-close de tarefas estratégicas
- evidência obrigatória para marcar entrega
- revisão humana final

## Tidy up seguro

Antes de limpar resíduos de runtime/worktrees:

1. confirmar ausência de colônias ativas (`/colony-pilot status`)
2. inspecionar artefatos (`/colony-pilot artifacts`)
3. limpar apenas resíduos antigos/inativos

Se houver risco de interferir em execução ativa, adiar limpeza.
