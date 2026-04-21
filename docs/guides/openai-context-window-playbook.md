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
3. Fechar com:
   - `npm run project:verification:check`
   - `project-validate`
   - `project-status`
   - update de `.project/handoff.json` (delta curto)

Esse playbook complementa o pipeline canônico: `docs/guides/project-canonical-pipeline.md`.
