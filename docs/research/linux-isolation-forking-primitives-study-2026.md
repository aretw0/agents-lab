# Linux isolation/forking primitives study 2026 (local-first viability)

Escopo: avaliar viabilidade técnica de isolamento/forking para trilha local-first com rollback explícito.

Referência de backlog: `TASK-BUD-625`.

## 1) Equivalentes práticos: hoje vs futuro

### A. Simulado (user-space, hoje)

- **Worktree/sandbox por processo** (git worktree, pastas isoladas, policies guardrail).
- **Container leve sem privilégio** (rootless + limites de CPU/memória).
- **Namespace parcial** via runtime existente (quando disponível), sem depender de novo syscall.

Uso recomendado agora:
- rehearsal report-only,
- validação focal curta,
- rollback por revert/descartar diretório efêmero.

### B. Kernel-native (futuro próximo)

- **BranchFS** e **branch() syscall** para forks baratos de contexto/FS.
- Isolamento mais nativo e possivelmente com menor custo de cópia/contexto.
- Requer maturidade de kernel, observabilidade e contratos de segurança mais fortes.

Uso recomendado:
- observe até estabilidade + toolchain confiável,
- experimentar só com escopo estritamente local-safe quando houver suporte testável.

### C. Kubernetes-integrado (futuro de escala)

- **Agent Sandbox (gVisor/Kata)** para boundary forte em ambiente orquestrado.
- Pod-level isolation com integração de política/telemetria.
- Maior custo operacional (infra, manutenção, debugging cross-layer).

Uso recomendado:
- canário tardio, apenas após trilha local consolidada e sem regressão de governança.

## 2) Riscos, custos e impacto CI/local

| Item | Risco de segurança/escape | Custo operacional | Impacto em CI/local |
|---|---|---|---|
| Simulado (hoje) | médio (isolamento lógico, não absoluto) | baixo-médio | baixo em local, médio em CI quando paraleliza demais |
| Kernel-native (BranchFS/branch) | médio-alto no início (superfície nova) | médio | potencial ganho alto local; CI depende de suporte do runner |
| Kubernetes + gVisor/Kata | baixo-médio (quando bem configurado) | alto | alto custo de setup; benefício mais claro em escala multi-tenant |

Riscos obrigatórios para gate:
- escape por configuração incorreta de sandbox;
- drift de permissões entre local e CI;
- falsa sensação de isolamento sem auditoria de boundary.

## 3) Posição de viabilidade para agents-lab (agora)

- **Curto prazo**: manter abordagem simulada e elevar qualidade de rollback/auditoria.
- **Médio prazo**: preparar canário report-only para isolamento mais forte (sem dispatch protegido automático).
- **Longo prazo**: reavaliar BranchFS/branch() e integração orquestrada conforme maturidade real.

## 4) Experimento local-safe mínimo (report-only)

### Nome
`isolation-forking-report-only-canary-v1`

### Objetivo
Medir ganho de previsibilidade/isolamento em fatia curta sem alterar fluxo protegido.

### Contrato
- **modo**: report-only;
- **escopo**: 1 task de baixo risco, arquivos declarados, sem `.github/`;
- **validação gate**: smoke focal conhecido antes/depois;
- **rollback**: `git restore --source=HEAD -- <arquivos>` ou `git revert <commit>`;
- **telemetria mínima**: duração, falhas, blocked-rate, divergência local↔CI.

### Critério de sucesso
- nenhuma regressão de governança,
- redução de retrabalho/contexto em pelo menos 1 dimensão observável,
- evidência registrada em board + handoff.

### Critério de abort
- falha de validação focal,
- qualquer sinal de risco/protected-scope não autorizado,
- aumento de custo sem benefício claro.

## 5) Conclusão

Há caminho para escalar produtividade com isolamento/forking, mas o ganho sustentável depende de sequência disciplinada:
1. limpeza e confiabilidade operacional,
2. pesquisa com critérios explícitos,
3. escalabilidade com canário bounded e auditoria forte.

Sem isso, a aceleração vira dívida operacional.
