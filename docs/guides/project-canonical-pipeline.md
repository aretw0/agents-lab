# Pipeline canônico de posteridade (.project-first)

Objetivo: preservar contexto de forma durável e retomável com baixo custo.

## Regra principal
1. **Canônico primeiro:** atualizar `.project/*`.
2. **Derivados depois:** `HANDOFF.md` (delta curto) e `ROADMAP.md` (macro).

## Diretriz de arquitetura (primitivas + adapters)
- O board `.project/*` é o **adapter canônico local atual** (fonte oficial de trabalho no workspace).
- A coordenação deve permanecer **backend-agnostic**: sistema de ticket/projeto é detalhe de implementação.
- A evolução first-party futura não substitui essa regra; ela entra como mais um adapter.
- Fluxos baseados em **Markdown/Obsidian** (ex.: inbox/caixa de notas) devem ser suportados via adapter, preservando os mesmos invariantes de governança (`no-auto-close`, evidência, revisão humana).
- Skills/processos/extensões com **hard intent** devem consumir o contrato de primitivas (task/event/intent/evidence), não um backend específico.

## Onboarding dual-mode (sem migração forçada)
Use este framing com usuários novos:

1. **Modo A — `.project-first` (canônico local)**
   - melhor quando o usuário quer governança integrada no workspace;
   - estado oficial em `.project/*`.

2. **Modo B — adapter-first (sistema do usuário)**
   - melhor quando o usuário já opera em outro sistema (Markdown/Obsidian, DB/API, automação/web);
   - o agente trabalha **junto** do sistema existente, sem impor migração total.

3. **Modo C — canônico + espelho humano (opcional)**
   - o estado oficial continua em `.project/*`;
   - um adapter projeta esse estado para Markdown renderizável (ex.: Obsidian/vault);
   - referência inicial de template: `https://github.com/aretw0/vault-seed`.

Invariantes em ambos os modos:
- `no-auto-close` para itens estratégicos;
- verificação auditável (`verification`) antes de `completed`;
- decisões/handoff curtos para retomada determinística.

## Loop operacional (5-10 min)
1. Capturar mudanças no board canônico:
   - `decisions`, `requirements`, `tasks`, `verification`, `handoff`.
2. Rodar higiene:
   - `npm run project:verification:check`
   - `npm run pi:artifact:audit` (ou `:strict` no gate)
   - `project-validate`
   - `project-status`
3. Atualizar derivados:
   - `HANDOFF.md` com **apenas delta operacional**.
   - `ROADMAP.md` com direção macro (sem estado diário).
4. Fechar sessão com WIP=1:
   - manter uma frente ativa em `in-progress` por sessão.

## Template rápido (copiar/colar)

### 1) Decisão (decisions)
- **id:** `DEC-<domínio>-<nnn>`
- **title:** decisão em 1 linha
- **status:** `decided`
- **context:** problema/risco
- **decision:** escolha feita
- **consequences:** trade-offs e impacto

### 2) Requisito (requirements)
- **id:** `REQ-<domínio>-<nnn>`
- **title:** regra/capacidade obrigatória
- **priority:** `must|should`
- **status:** `accepted|proposed`
- **acceptance_criteria:** lista objetiva

### 3) Task (tasks)
- **id:** `TASK-<domínio>-<nnn>`
- **description:** objetivo curto
- **status:** `planned|in-progress|completed|blocked`
- **files:** superfícies tocadas
- **acceptance_criteria:** 2-4 critérios testáveis
- **notes:** evidência e contexto resumidos

### 4) Verificação (verification)
- **id:** `VER-<domínio>-<nnn>`
- **target:** `TASK-...`
- **target_type:** `task`
- **status:** `passed|partial|failed`
- **method:** `command|inspect|test` (agnóstico de stack)
- **evidence:** evidência curta e auditável
- **timestamp:** ISO

## Soft intent vs Hard gate de qualidade
- **Soft intent (advisory):** monitor orienta verificar em granularidade de slice; não bloqueia sozinho.
- **Hard gate (canônico):** promoção/conclusão estratégica requer `verification` com `status=passed` vinculada ao target.
- Use `inspect` para governança/doc/processo e `command/test` quando houver impacto executável.
- Referência de contrato: `docs/primitives/quality-verification-gate.md`.

## Guardrail de scan-bounds no loop longo
Em sessões com `context_watch` em `warn`/`checkpoint`/`compact`:
1. **Warn:** somente investigação bounded-by-default (sem busca ampla em logs/sessions).
2. **Checkpoint:** handoff canônico obrigatório antes de novo diagnóstico.
3. **Compact:** parar investigação, compactar e retomar do handoff.

Checklist operacional rápido:
- consultar no máximo o arquivo-alvo do sintoma;
- usar janela curta (`offset/limit`) e evitar fan-out recursivo;
- registrar achado em 1–3 linhas no checkpoint;
- adiar varredura profunda para sessão pós-compact com contexto saudável.

## Remediação de artefatos pi já commitados (sem perder progresso)

Quando descobrir que um artefato efêmero entrou no git por engano:

### Cenário A — remediação leve (recomendado por padrão)

Use quando não há dado sensível e o objetivo é apenas parar de versionar.

1. confirmar trabalho local antes de qualquer ação:
   - `git status --short`
2. conferir violações da policy:
   - `npm run pi:artifact:audit`
3. remover do índice sem apagar cópia local:
   - `git rm --cached -- <path>`
4. garantir ignore para recorrência (`.gitignore`/baseline)
5. validar novamente:
   - `npm run pi:artifact:audit:strict`

### Cenário B — remediação pesada (histórico)

Use somente com confirmação explícita quando houver exposição sensível real.

1. rotacionar credenciais primeiro;
2. planejar rewrite de histórico (janela coordenada com time);
3. executar purge seletivo e comunicar force-push;
4. revalidar baseline com `pi:artifact:audit:strict`.

> Regra de pragmatismo: prefira Cenário A sempre que possível; Cenário B só quando o risco justificar custo operacional.

## Política de retomada pós-compactação
Retomar apenas com:
1. `.project/handoff.json`
2. `.project/tasks.json`
3. checkpoint curto em `docs/research/...` (se houver)

Se esses três estiverem íntegros, não é necessário reconstruir contexto narrativo longo.
