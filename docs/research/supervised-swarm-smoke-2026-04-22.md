# Supervised Swarm Smoke Run — 2026-04-22 (TASK-BUD-097)

## Objetivo
Registrar um smoke run supervisionado e de baixo risco para o TASK-BUD-097, com escopo estritamente documental, validando que a atualização do relatório foi aplicada corretamente sem impactar código, automações ou estado de tarefas estratégicas.

## Escopo reduzido
- Alterar **somente** documentação em `docs/research/`.
- Produzir/atualizar apenas este relatório de execução supervisionada.
- Não executar mudanças em código-fonte, scripts de build/teste ou configuração operacional.
- Não auto-encerrar tarefas estratégicas; qualquer fechamento segue governança manual fora deste smoke run.

## Arquivo(s) alterado(s)
- `docs/research/supervised-swarm-smoke-2026-04-22.md` — atualizado para alinhar ao template canônico de run supervisionada.

## Critérios de abort/rollback para retorno a L2
Acionar abort/rollback e retornar a operação para L2 se ocorrer qualquer uma das condições abaixo:
1. Identificação de necessidade de alteração fora de documentação (ex.: `packages/`, `scripts/`, configs de runtime).
2. Falha de validação básica de integridade do arquivo (arquivo ausente, conteúdo incompleto ou estrutura obrigatória não atendida).
3. Divergência com diretriz de governança (tentativa de auto-close de tarefa estratégica ou alteração de estado operacional).
4. Conflito de edição que comprometa rastreabilidade do registro.

Procedimento de rollback (docs-only):
- Reverter este arquivo para a revisão anterior no branch de trabalho.
- Reexecutar verificação mínima de presença/estrutura.
- Registrar incidente e escalonar para L2 com evidências do ponto de falha.

## Final file inventory
- `docs/research/supervised-swarm-smoke-2026-04-22.md` — relatório atualizado e normalizado conforme template canônico (seções mínimas obrigatórias preservadas).

## Validation command log
- `ant_colony(goal="Executar uma run supervisionada mínima para validar gate L2->L3 ...", maxCost=1.5)`
- `read .sandbox/pi-agent/ant-colony/c/Users/aretw/Documents/GitHub/agents-lab/colonies/colony-moajtbm1-2g4py/state.json`
- `read .sandbox/pi-agent/ant-colony/c/Users/aretw/Documents/GitHub/agents-lab/worktrees/c1-moajtbbf-zy4t9/docs/research/supervised-swarm-smoke-2026-04-22.md`
- `cmd.exe /c "git -C C:\Users\aretw\Documents\GitHub\agents-lab\.sandbox\pi-agent\ant-colony\c\Users\aretw\Documents\GitHub\agents-lab\worktrees\c1-moajtbbf-zy4t9 status --short"`

## Observações finais
- O smoke supervisionado foi executado em worktree isolada com budget explícito (`maxCost=1.5`).
- Durante a run, surgiram edições fora de escopo (`CONTRIBUTING.md`, `README.md`, `docs/guides/agent-driver-charter.md`) no worktree da colônia; aplicamos rollback operacional para L2 por **promoção seletiva docs-only** e sem auto-close estratégico.
- Este registro não implica auto-fechamento de TASK-BUD-097.
