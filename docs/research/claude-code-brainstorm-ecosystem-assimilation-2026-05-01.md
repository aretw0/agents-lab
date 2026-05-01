# Assimilação bounded — ideia de "brainstorm" do ecossistema Claude Code

Data: 2026-05-01  
Task: `TASK-BUD-436`  
Escopo: pesquisa local-first para transformar a ideia de brainstorm em lane operacional do control-plane, sem ativar modos protegidos.

## 1) O que queremos assimilar (e o que não queremos)

### Queremos

- uma sessão de ideação que gere **lane de trabalho útil** para bastante tempo;
- saída em formato operacional: fatias pequenas, critérios claros, validação e rollback;
- governança local-first: sem auto-dispatch para CI/remote/offload/scheduler.

### Não queremos

- brainstorming solto que vira repetição neurótica;
- ideias sem critério de prioridade/risco;
- ferramenta que já execute mudanças protegidas.

## 2) Evidências locais relevantes

### 2.1 Budget/request model do Claude Code adapter local

Arquivo analisado: `packages/pi-stack/extensions/claude-code-adapter.ts`

Pontos úteis para design:

- budget por request em sessão (`sessionRequestCap`, `warnFraction`);
- estados explícitos (`ok|warn|block`);
- execução com `dry_run` e com gate antes do subprocesso.

Implicação: um brainstorm inspirado em Claude Code precisa tratar orçamento/cadência como parte do contrato, não detalhe posterior.

### 2.2 Tentativa real de brainstorm nesta sessão

Foi executado `claude_code_execute` com prompt bounded para gerar 8-12 slices. Resultado:

- `You've hit your limit · resets 1:20pm (America/Sao_Paulo)`

Implicação: depender de uma única chamada externa para produzir lane é frágil. Precisamos de fallback local deterministicamente útil.

## 3) Contrato proposto para "brainstorm de lane"

Proposta de primitive (report-only): `lane_brainstorm_packet`.

### Entrada

- objetivo da lane (texto curto);
- restrições operacionais (local-first, no protected auto);
- estado atual do board (tasks candidatas + bloqueios);
- orçamento/cadência (máximo de slices por batch).

### Saída

- `ideas[]` (tema + valor + risco + esforço);
- `selectedSlices[]` (3-5 slices priorizadas);
- `recommendationCode` (ex.: `seed-local-safe-lane`, `stop-no-local-safe`, `needs-human-focus-protected`);
- `nextAction` textual curto;
- `dispatchAllowed=false`, `authorization=none`, `mutationAllowed=false`.

### Invariantes

- read-only/report-only;
- sem stage/commit/apply/scheduler/remote;
- exige decisão humana para qualquer protected lane.

## 4) Pipeline estratégico (anti-gordura)

Para evitar repetição sem direção:

1. **Divergir bounded**: gerar no máximo 8-12 ideias.
2. **Convergir com score**: risco x valor x alinhamento com objetivo.
3. **Fatiar**: transformar top ideias em 3-5 micro-slices com validação/rollback.
4. **Semear board**: criar tasks com acceptance criteria objetiva.
5. **Rodar batch local**: executar com checkpoint/commit por fatia.

## 5) Backlog inicial local-safe para implementar essa assimilação

1. `TASK-BUD-437` (planejado): especificar schema do `lane_brainstorm_packet` (read-only).
2. `TASK-BUD-438` (planejado): implementar scorer simples para ideias (valor/risco/esforço).
3. `TASK-BUD-439` (planejado): surface report-only para emitir packet com `recommendationCode` + `nextAction`.
4. `TASK-BUD-440` (planejado): smoke tests de contrato (sem mutação, sem dispatch).

## 6) Decisão desta pesquisa

A ideia de brainstorm do ecossistema Claude Code é útil **como método de geração de lane**, mas deve ser assimilada como primitive local-first, report-only, com budget-aware e fail-closed para protected scopes.

Isso permite maturidade real: o control-plane fica ocupado com trabalho bom por mais tempo, sem abrir mão de governança.
