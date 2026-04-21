# OpenAI Context Window Playbook (lean → governed → swarm)

Objetivo: maximizar qualidade por token e evitar saturação de contexto usando a lane certa para cada tipo de trabalho.

## Evidência base (benchmark canônico)
- `run-2026-04-20-r7-post-hygiene-json-recovery` (A/B comparável)
  - **A pure**: `1072` total tokens
  - **B stack-default**: `13931` total tokens (~`+1216.56%` input)
- `run-2026-04-20-r8-split-overhead` (decomposição)
  - **E stack-no-extensions**: `6909` total tokens
  - **B stack-default**: `13931` total tokens

Leitura prática: stack completo é útil para governança, mas custa muito mais contexto. Para trabalho simples, usar lane lean.

---

## Lane 1 — Lean (default para trabalho simples)
Use para: leitura/edição pontual, refactor pequeno, revisão curta, prompts diretos.

Comando base:
```bash
pi --model openai-codex/gpt-5.3-codex --no-extensions --no-skills --no-prompt-templates --no-themes
```

Trade-off:
- ✅ menor custo/latência/context tax
- ❌ sem guardrails/automação de runtime da stack

---

## Lane 2 — Governed (quando precisa política e observabilidade)
Use para: alterações de governança, budget, monitoria, handoff canônico, workflows com policy.

Comando base:
```bash
pi --model openai-codex/gpt-5.3-codex
```

Trade-off:
- ✅ guardrails, policies, ferramentas da stack
- ❌ maior taxa fixa de contexto

---

## Lane 3 — Swarm/Heavy (execução paralela e tarefas grandes)
Use para: lotes multi-arquivo, mudanças com validação cruzada, execução candidate/recovery.

Pré-condição:
- declarar budget (`maxCost`) e critérios de evidência
- manter `.project` como fonte canônica

Trade-off:
- ✅ throughput e cobertura
- ❌ custo/latência/contexto mais altos

---

## Gatilho de troca de lane (antes de estourar contexto)
Trocar para lane mais enxuta quando ocorrer qualquer um:
1. 2 ciclos sem decisão nova.
2. Aumento de escopo sem mudança de prioridade.
3. Resposta fica mais lenta e verbose sem ganho de progresso.
4. Você precisa só de uma edição/análise local curta.

---

## Ritual curto por sessão
1. Escolher lane explicitamente no início.
2. Manter WIP=1.
3. Rodar calibração reproduzível:
   - `npm run calibrate:repro` (determinístico/offline; defaults bounded: monitor tail 200k, readiness tail 600k)
   - `npm run calibrate:repro:canary` (opt-in, gera evidências em `.pi/reports`)
   - `npm run calibrate:repro:token` (opt-in com request real, budget cap por `--real-token-max-requests`)
4. Fechar com:
   - `npm run project:verification:check`
   - `project-validate`
   - `project-status`
   - update de `.project/handoff.json` (delta curto)

### Canary real (token) com budget cap

Crie `.pi/real-token-canary.command.json` com o comando one-shot:
```json
{
  "command": "C:/Users/aretw/scoop/apps/nodejs/current/node.exe",
  "args": [
    "C:/Users/aretw/scoop/persist/nodejs/bin/node_modules/@mariozechner/pi-coding-agent/dist/cli.js",
    "--print",
    "Responda exatamente: OK",
    "--no-tools",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes"
  ]
}
```

Notas:
- `real-token-max-requests` limita hard o número de requests (padrão `1`, máx `5`).
- `real-token-timeout-ms` limita tempo por request para evitar runaway.

## Context pressure model-aware (footer)

A `custom-footer` agora usa thresholds por `provider/model` para colorir `% de contexto`:
- baseline geral: warning `50%`, error `75%`
- `anthropic/*`: warning `65%`, error `85%`
- `github-copilot/claude-*` **não** herda automaticamente perfil Anthropic (fica no baseline, salvo override)

Override opcional em `.pi/settings.json`:
```json
{
  "piStack": {
    "customFooter": {
      "contextPressure": {
        "byProviderModel": {
          "github-copilot/claude-sonnet-4-6": { "warningPct": 60, "errorPct": 80 }
        }
      }
    }
  }
}
```

## Context watchdog (advisory, não-bloqueante)

A extensão `context-watchdog` adiciona sinais operacionais para sessões long-run:
- tool: `context_watch_status`
- command: `/context-watch [status|reset]`
- status key: `context-watch`

Defaults derivados (sem override):
- baseline `warn=50` (footer) → `checkpoint=68`, `compact=72`
- `anthropic/* warn=65` (footer) → `checkpoint=78`, `compact=82`

Níveis:
- `warn` → operar em micro-slices
- `checkpoint` → registrar handoff antes do próximo slice grande
- `compact` → compactar e retomar do checkpoint

Config opcional em `.pi/settings.json`:

```json
{
  "piStack": {
    "contextWatchdog": {
      "enabled": true,
      "checkpointPct": 68,
      "compactPct": 72,
      "cooldownMs": 600000,
      "notify": true,
      "status": true
    }
  }
}
```

Observação: `warnPct` é herdado do threshold model-aware do `custom-footer` (`contextPressure`).

Esse playbook complementa o pipeline canônico: `docs/guides/project-canonical-pipeline.md`.
