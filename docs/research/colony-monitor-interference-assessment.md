---
created: 2026-04-13
status: draft
---

# Colony × Monitors — Avaliação Inicial de Interferência

## Pergunta

Monitores do `@davidorex/pi-behavior-monitors` podem atrapalhar a execução da colônia (`@ifi/oh-pi-ant-colony`)?

## Evidência estática (código)

### 1) Dentro dos ants da colônia

No ant-colony, cada ant é criado com `createAgentSession(...)` usando um `ResourceLoader` mínimo:

- `node_modules/@ifi/oh-pi-ant-colony/extensions/ant-colony/spawner.ts`
  - `makeMinimalResourceLoader()` retorna:
    - `getExtensions: () => ({ extensions: [], ... })`
    - `getSkills: () => ({ skills: [], ... })`

Implicação: **ants não carregam extensões/skills de sessão**, incluindo monitores do davidorex.

### 2) No processo principal (queen/main session)

A extensão de monitores do davidorex roda no processo principal e pode atuar em eventos da sessão (`message_end`, `turn_end`, `agent_end`, `tool_call`).

- `node_modules/@davidorex/pi-behavior-monitors/dist/index.js`
  - eventos registrados em `pi.on(...)`
  - coleta de contexto inclui `custom_messages`

Como a colônia injeta mensagens custom (`ant-colony-progress`, `ant-colony-report`) no processo principal, existe risco de **interação indireta** entre monitor de sessão e fluxo da queen.

## Conclusão inicial (sobriedade)

- **Não há evidência de mistura dentro dos ants** (soldier/scout/worker/drone).
- **Há possibilidade de atrito no processo principal** (monitor de sessão observando sinais da colônia).

## Próximo experimento recomendado

A/B operacional de pilot de colônia:

- Braço A: monitores davidorex ON
- Braço B: monitores davidorex OFF durante colônia

Métricas:
- taxa de conclusão da colônia
- latência total por missão
- quantidade de steers/blocks externos ao fluxo da colônia
- ruído no contexto da queen (mensagens de monitor)

Decisão posterior: coexistência por default vs profile "colony mode" com monitorização de sessão reduzida.
