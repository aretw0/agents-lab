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
- tools: `context_watch_status`, `context_watch_bootstrap`
- command: `/context-watch [status|reset|bootstrap [control-plane|agent-worker]|apply [control-plane|agent-worker]]`
- status key: `context-watch`

Defaults derivados (sem override):
- baseline `warn=50` (footer) → `checkpoint=68`, `compact=72`
- `anthropic/* warn=65` (footer) → `checkpoint=78`, `compact=82`

Níveis:
- `warn` → operar em micro-slices
- `checkpoint` → registrar handoff antes do próximo slice grande
- `compact` → compactar e retomar do checkpoint

Visibilidade operacional (control-plane):
- Em escalonamento (`warn/checkpoint/compact`), o watchdog registra trilha canônica em `.project/handoff.json`:
  - `next_actions` recebe linha `Context-watch action: ...`
  - `blockers` recebe marcador contextual (`context-watch-*-required`)
  - `context_watch_events` recebe histórico estruturado (`atIso`, `level`, `percent`, `action`, `recommendation`)
- O notify passa a incluir `action:` e caminho do handoff atualizado.

### Guardrail de investigação sob pressão (bounded-by-default)
Quando `context_watch` estiver em `warn` ou acima:
- evitar varredura ampla/recursiva em sessões e logs;
- preferir leitura direcionada por arquivo com `read` + `offset/limit`;
- testar hipóteses em janelas curtas (1 arquivo, 1 pergunta, 1 evidência);
- em `checkpoint`, registrar handoff antes de qualquer diagnóstico adicional;
- em `compact`, interromper investigação e continuar só após compactação.

Fallback determinístico (quando o aviso não apareceu no chat principal):
1. Rodar `context_watch_status`.
2. Verificar `.project/handoff.json` em `context_watch_events` e `Context-watch action:`.
3. Executar a ação indicada (`micro-slice-only`, `write-checkpoint`, `compact-now`) antes de iniciar novo slice grande.

Sintoma clássico de violação: salto abrupto de contexto sem ganho de decisão.
Resposta padrão: parar, checkpoint curto, compactar e retomar pelo handoff.

Para bootstrap portável de novos agentes, use:
- `context_watch_bootstrap` com `preset=control-plane` (sessões long-run)
- `context_watch_bootstrap` com `preset=agent-worker` (delegados/worker com menos notify)
- `context_watch_bootstrap` com `apply=true` (persiste patch em `.pi/settings.json` e ativa no runtime do context-watchdog sem `/reload`)

Para reduzir re-leitura repetitiva pós-compactação, gere um warm pack por telemetria real:
- `npm run context:preload` (inspeção humana)
- `npm run context:preload:write` (gera JSON em `.sandbox/pi-agent/preload/context-preload-pack.json`)

Consumo fail-closed do pack (com fallback canônico quando stale):
- `npm run context:preload:consume` (`control-plane-core`)
- `npm run context:preload:consume:worker` (`agent-worker-lean`)
- `npm run context:preload:consume:scout` (`swarm-scout-min`)
- runtime tool read-only: `context_preload_consume`

Saídas sugerem dois perfis de carga:
- `control-plane-core`: contexto mínimo para coordenação/decisão.
- `agent-worker-lean`: contexto mínimo para execução delegada.

Esses perfis servem tanto para `.project-first` quanto para modo adapter/mirror (ex.: projeção para vault Markdown), sem exigir releitura ampla no spawn.

Config opcional em `.pi/settings.json` (conservador para evitar 400 em provedores sensíveis):

```json
{
  "piStack": {
    "contextWatchdog": {
      "enabled": true,
      "checkpointPct": 60,
      "compactPct": 65,
      "cooldownMs": 600000,
      "notify": true,
      "status": true
    }
  }
}
```

Observação: `warnPct`/`errorPct` são herdados do threshold model-aware do `custom-footer` (`contextPressure`).
Para `github-copilot/gpt-5.3-codex`, o baseline recomendado é mais conservador (`errorPct=65`) para reduzir risco de `400 input exceeds context window`.

## Blueprint — Fresh Context Pack (pós-compact e spawn)

Objetivo: manter agentes fresh com **contexto mínimo canônico**, sem releitura ampla, e com fallback seguro.

### Fontes mínimas canônicas (ordem fixa)
1. `.project/handoff.json` (foco atual, próximos passos, blockers, `context_watch_events` recentes)
2. `.project/tasks.json` (status/deps apenas para IDs em foco)
3. `.project/verification.json` (última evidência ligada ao foco)

Regra: carregar **somente** os recortes ligados ao foco ativo (WIP=1), nunca snapshot completo por padrão.

### Perfis por lane
- `control-plane-core`
  - inclui: foco atual, decisão pendente, blockers, último checkpoint.
  - uso: coordenação e continuidade de sessão principal.
- `agent-worker-lean`
  - inclui: objetivo do slice, arquivos declarados, gate de validação e rollback.
  - uso: spawn simples (single-agent, bounded).
- `swarm-scout-min`
  - inclui: objetivo, restrições, critérios de evidência e limite de pesquisa.
  - uso: scouts; workers recebem payload derivado do scout, não releitura global.

### Staleness/invalidação (fail-closed)
Invalidar o pack e regenerar quando qualquer condição ocorrer:
1. `handoff.updated_at` mudou após geração do pack.
2. task foco mudou (`current_tasks`) ou status/deps do foco mudaram.
3. nova verificação relevante foi anexada ao foco.
4. janela de frescor estourou (`handoffFreshMaxAgeMs`).

Se inválido/ausente: cair automaticamente para caminho canônico seguro (`handoff -> tasks -> verification`), sem heurística opaca.

### Contrato operacional curto
- compactou -> gerar/atualizar pack mínimo;
- retomou -> validar staleness antes de usar pack;
- spawnou agente -> anexar apenas o perfil da lane correspondente;
- detectou drift -> descartar pack e regenerar.

Esse playbook complementa o pipeline canônico: `docs/guides/project-canonical-pipeline.md`.
