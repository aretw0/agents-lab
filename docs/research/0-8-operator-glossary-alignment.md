# Glossário de operação local-safe 0.8.0

Data: 2026-05-06 
task: `TASK-BUD-929`  
lane: `0.8-local-safe-compounding-lane`

## Termos locais

### lane

Conjunto de tarefas e regras temporais com foco convergente. Aqui, `0.8-local-safe-compounding-lane` é a trilha de estabilização contínua.

### slice

Unidade pequena e reversível de execução. Deve ter:
- escopo delimitado;
- validação prévia;
- rollback simples.

### local-safe

Execução sem dispatch para processos externos, sem mutation de settings/provedores/CI/secretos, sem limpeza destrutiva. Prioriza documentação, board, templates e testes locais com escopo reduzido.

### report-only

Leitura/decisão sem ação executora de agentes/colônias/schedulers. Exemplos:
- leitura de packets,
- síntese de readiness,
- criação de checklists e templates.

### protected

Escopos que exigem autorização explícita: `.pi/settings.json`, rotas de provider, `monitor-provider apply`, CI/workflows, secrets/billing, publish/release, remote/offload, alterações destrutivas.

### parked

Itens úteis fora de execução ativa: influências, sugestões ou itens de médio/longo prazo aguardando condição de retorno.

### validation gate

Passo obrigatório e simples que prova que a fatia foi aplicada corretamente antes de seguir adiante. Ex.: `safe_marker_check`, `i18n_lint_text`, `board_dependency_health_snapshot`, smoke focal.

### rollback cue

A evidência do que desfaz. Para esta lane, padrão é `git revert <commit>` ou restauração do commit/documento afetado.

### stop condition

Condição clara de pausa antes de continuar. Ex.: blocker protegido aparecendo, continuidade local inválida, perda de foco, validação desconhecida.

### readiness

Estado atual de maturidade para avançar com baixo risco. Lê-se aqui como combinação de:
- clareza de foco,
- continuidade limpa,
- validadores conhecidos,
- ausência de dependências bloqueantes.

### handoff/checkpoint

Snapshot resumido no `.project/handoff.json` para retomada sem reabrir discussão longa no próximo turno.

### runway

Conjunto de gatilhos que, ao serem atendidos, permite subir de modo de operação: de local-safe para preparação de delegação e depois para execução mais assistida.

## Regra de linguagem

Priorizar linguagem curta, imperativa e explícita. Se um termo não estiver no dicionário acima, pedir definição antes de expandir escopo.
