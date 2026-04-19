# Notas de Assimilação First-Party (futuro)

> Objetivo: registrar funcionalidades hoje suprimidas por conflito para eventual centralização na stack first-party.
>
> **Não é backlog de execução imediata.**
> Serve como memória técnica para próximas fases quando a base estiver estável.

## Contexto

Hoje a `pi-stack` aplica filtros em pacotes third-party para evitar colisões de tool/command/UX.
Isso reduz risco operacional no curto prazo, mas também “esconde” capacidades potencialmente úteis.

Diretriz: manter filtros agora, consolidar experiências, e só depois migrar para implementação first-party quando houver contrato/teste claro.

## Casos observados

### 1) `mitsupi/pi-extensions/uv.ts` vs `bg-process`

- Sintoma: colisão de surface/tool (incluindo relatos de conflito percebido em keybindings/fluxo de terminal).
- Estado atual: `uv.ts` permanece excluído via installer filter (`!pi-extensions/uv.ts`).
- Possível evolução first-party:
  - unificar runtime de processos/background + comandos de conveniência em um único owner.
  - expor capability flag explícita para decidir qual surface ativa por perfil.

### 2) `oh-pi-extensions/custom-footer.ts` vs footer first-party da stack

- Sintoma: duplicidade de footer/status e competição por superfície de observabilidade.
- Estado atual: versão upstream suprimida; footer first-party agrega quota + pilot + colony panel.
- Possível evolução first-party:
  - tornar o footer composável por “blocos” (quota, colony, scheduler, alerts) com toggle declarativo.

### 3) Skills duplicadas (`commit`, `github`, `web-browser`, `git-workflow`, etc.)

- Sintoma: colisão de nomes entre pacotes.
- Estado atual: filters/known-collisions em smoke.
- Possível evolução first-party:
  - namespace/alias oficial por domínio,
  - camada de roteamento de skill com prioridade explícita e telemetria de fallback.

### 4) Visibilidade de "agents-as-tools" (classificadores/monitores)

- Sintoma: execução de classificadores só fica evidente quando sai warning/output, com baixa visibilidade durante a conversa.
- Estado atual: sem superfície de progresso unificada para micro-execuções de monitor.
- Possível evolução first-party:
  - status line/painel com "agentes de monitor ativos" + latência,
  - integração opcional com superfície de processos em background,
  - budget/timeout explícito para classificações para preservar economia.

## Critério para “promover” algo a first-party

Só promover quando todos os itens abaixo estiverem verdadeiros:

1. **Contrato de uso estável** (comandos, parâmetros, semântica) validado por uso real.
2. **Teste determinístico** cobrindo regressão do conflito original.
3. **Owner único declarado** (capability ownership sem ambiguidade).
4. **Plano de migração** sem quebrar setups já instalados.
5. **Fallback seguro** (feature flag/profile para rollback rápido).

## Regra operacional

- Curto prazo: **não reabrir conflitos antigos** no meio de entregas críticas.
- Médio prazo: usar este documento como checklist de decisão ao planejar assimilação.
- Longo prazo: reduzir filtros ad-hoc conforme superfícies first-party substituírem os pontos frágeis.
