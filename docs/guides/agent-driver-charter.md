# Agent Driver Charter — agents-lab

**Status:** active  
**Data:** 2026-04-16  
**Relacionado:** TASK-BUD-016, TASK-BUD-017  
**Revisão humana obrigatória para alterações de critérios de parada ou limites de autonomia.**

---

## Norte verdadeiro (North Star)

Construir um laboratório de agentes que seja **soberano, auditável e auto-sustentável**: capaz de executar ciclos de melhoria sobre si mesmo usando os próprios agentes que produz, com custo controlado, evidência verificável e supervisão humana nos pontos de decisão estratégica.

A operação autônoma é meio, não fim. O objetivo final é ter primitivas e padrões reutilizáveis que outros projetos possam adotar.

---

## Critérios de priorização (como escolher a próxima tarefa)

Um agente autônomo deve seguir esta ordem ao selecionar a próxima tarefa do board:

### 1. Desbloqueadores críticos primeiro

Tarefa é elegível se:
- `status` é `planned` (não `in-progress`, `blocked`, `completed`)
- Todos os `depends_on` estão `completed`
- É `[P0]`

Dentro dos P0, preferir tarefas cujo fechamento **unbloca mais tarefas** (checar quem lista essa task em `depends_on`).

### 2. Depois P1 com dependências satisfeitas

Mesma regra, `[P1]` com todos os `depends_on` resolvidos.

### 3. Nunca tocar

- Tasks com `status: blocked` sem plano de desbloqueio claro
- Tasks com `[COLONY:...]` — essas são instâncias de execução, não backlog
- Tasks com `[RECOVERY:...]` — só avançar após revisão humana

---

## Limites de autonomia

### O que um agente pode fazer sem aprovação humana

- Criar tasks novas (status `planned`) com ID sequencial
- Escrever documentação, guias, research docs
- Implementar código com cobertura de teste
- Fechar tasks de `[P1]` ou `[P2]` quando todos os ACs forem verificáveis via testes/verify
- Registrar evidência em tasks existentes

### O que exige confirmação humana antes de executar

- Fechar tasks `[P0]` estratégicas
- Alterar `status` de tasks de `[COLONY:...]` para `completed`
- Modificar `CLAUDE.md`, `.pi/settings.json`, ou arquivos de governança (`.project/requirements.json`, `.project/decisions.json`)
- Publicar versões (npm publish, tags de release)
- Forçar branches ou reescrever histórico

### Stop conditions (parar e chamar humano)

Um agente deve parar imediatamente quando:

1. **Budget em WARN ou BLOCK** para o provider ativo → chamar `/quota-visibility` e aguardar handoff
2. **Todas as tasks P0 elegíveis bloqueadas** (dependências circulares ou todas precisam de aprovação) → reportar e aguardar
3. **Falha de validação repetida** (verify ou test falhando após 2 tentativas de fix) → não persistir; reportar estado e parar
4. **Conflito de merge não-trivial** em `.project/tasks.json` → não resolver automaticamente; chamar humano
5. **Escopo de mudança > 5 arquivos** numa task que parecia simples → pausar e confirmar escopo antes de continuar
6. **Orçamento de contexto em risco** (planejamento crescendo sem fechar decisão) → parar, consolidar mini-handoff e retomar em lote menor

---

## Contratos invariantes (nunca quebrar)

| Contrato | Descrição |
|----------|-----------|
| **No auto-close** | Tasks estratégicas (P0, colonies) só fecham com revisão humana |
| **Evidência obrigatória** | Nenhuma task fecha sem inventário de arquivos + resultado de validação |
| **Board canônico** | `.project/tasks.json` é o relógio oficial — não criar shadow boards |
| **Budget envelope** | Toda execução de colônia exige `maxCost` explícito |
| **Reversibilidade** | Toda mudança crítica deve ter caminho de rollback |
| **Isolamento de sessão** | Runs de CI/automação usam `PI_CODING_AGENT_DIR` isolado |

---

## Como um agente determina a próxima tarefa elegível

```
1. Carregar .project/tasks.json
2. Filtrar: status = 'planned', todos os depends_on = 'completed'
3. Ordenar: P0 primeiro, depois P1, depois P2
4. Para empate: preferir a que desbloqueie mais outras tasks
5. Verificar se não é COLONY:, RECOVERY:, ou task com "requires human"
6. Verificar budget: /quota-visibility → se BLOCK, parar
7. Selecionar e marcar como 'in-progress' no board antes de iniciar
```

---

## Protocolo anti-estouro de contexto (planejamento grande)

Quando o plano for amplo, o agente deve operar em **micro-lotes**:

1. **Lote curto:** no máximo 3-5 decisões por iteração.
2. **Checkpoint obrigatório:** ao fim de cada lote, produzir mini-handoff (estado atual + próximos 3 passos).
3. **Delegação por trilha:** separar investigação por eixo (policy, budget, docs, research) e consolidar só o essencial.
4. **Pesquisa em shards:** preferir perguntas menores e sequenciais em vez de investigação monolítica.
5. **Gatilho de consolidação:** se a sessão ficar longa sem decisão fechada, parar e resumir antes de continuar.

### Limiar objetivo para "contexto em risco"

Acionar consolidação quando **qualquer** condição abaixo ocorrer:

- 2 ciclos consecutivos sem decisão fechada;
- mais de 3 trilhas ativas ao mesmo tempo sem checkpoint;
- produção de resposta/planejamento muito extensa sem mini-handoff intermediário.

### Fluxo de delegação por trilha (reutilizável)

Para planejamento amplo, separar em até 4 trilhas paralelas:

| Trilha | Entrada | Saída esperada |
|--------|---------|----------------|
| Policy | dúvidas de roleModels/modelPolicy/enforcement | mapa de regras + riscos |
| Budget | budgets, janelas, WARN/BLOCK, handoff | recomendação de rota + limites |
| Docs | charter/protocol/guides | atualização objetiva + checklist |
| Research | referências externas/repos | comparativo curto com decisão de adoção |

**Contrato de consolidação:** cada trilha retorna no máximo 5 bullets; a consolidação final fecha no máximo 3 decisões por lote.

---

## Ciclo operacional por run

Cada execução autônoma deve:

1. **Pre-run**: `git status` limpo + `/colony-pilot status` + budget OK
2. **Execução**: uma task por vez; marcar `in-progress` antes de começar
3. **Checkpoint de contexto (se necessário)**: se planejamento ficar grande, fazer mini-handoff e quebrar em novo lote
4. **Pós-run imediato**: produzir inventário de arquivos + resultado de validação
5. **Atualizar board**: notas com evidência; task candidata a fechamento (não auto-close P0)
6. **Commit**: somente código testado e verificado; mensagem de commit com task ID

### Discovery de trabalho repetitivo (budget-aware)

Quando houver sinais de repetição com gasto recorrente de LLM:
- usar `session_analytics_query` (`galvanization`) para levantar candidatos com ranking e evidência (`tokens/cost/requests`);
- registrar proposta de pathway hard por candidato (gates + equivalência + rollback), sem ativar automaticamente;
- manter roadmap baseline vs pós-automação no board para priorizar conversão com menor risco.

Contrato: descoberta é **advisory-first**; promoção para hard pathway continua sob governança canônica (`no-auto-close`, `verification`, decisão humana quando estratégico).

---

## Mensagens durante long-runs (sem desviar o lane)

Para manter loops longos estáveis:

1. **Padrão native-first:** usar steer/follow-up nativo (`Alt+Enter` / `app.message.followUp`) como trilha principal.
2. **Fila de lane (opt-in):** usar `/lane-queue` apenas quando houver deferimento cross-turn para janela idle sem interromper o trabalho atual.
3. **Forçar agora (escape hatch):** prefixar com `lane-now:` quando processamento imediato for realmente necessário.

`/lane-queue` suporta `status|help|list|add <texto>|pop|clear` e mantém trilha auditável no runtime (`guardrails-core.long-run-intent-*`).
Quando `queued>0`, o status deve orientar discoverability explícita (`/lane-queue list` e `/lane-queue clear`).
O auto-drain ocorre apenas em janela idle estável (cooldown + idleStableMs configuráveis).

### Policy no-obvious-questions (autonomia pragmática)

Durante long-runs, o agente deve aplicar default seguro para ambiguidades de baixo risco sem interromper o usuário.
Escalonar pergunta apenas para:
- ação irreversível;
- risco de perda de dados/segurança;
- conflito explícito de objetivo.

Trilha auditável esperada no runtime:
- `guardrails-core.pragmatic-autonomy-policy` (policy ativa por turno)
- `guardrails-core.pragmatic-assumption-applied` (assunção automática aplicada)

### Fronteiras modulares do runtime-guardrails (anti-bloat)

Para preservar throughput e manutenção da fábrica, `guardrails-core.ts` deve operar como **orquestrador** (wiring/eventos), com domínios pesados extraídos em módulos coesos.

Fronteiras atuais:
- `guardrails-core-bloat.ts`: config + utilitários de bloat-smell (texto/código);
- `guardrails-core-lane-queue.ts`: config e helpers da lane-queue (storage, gates, auto-drain);
- `guardrails-core.ts`: composição de eventos (`input`, `turn_end`, `tool_call`, comandos) e integração entre domínios.

Regra para novas features:
- se a lógica for reutilizável/testável isoladamente, **nasce fora** de `guardrails-core.ts`;
- manter contrato público estável via import/re-export quando necessário;
- evitar inserir novos blocos de regra longa diretamente no orquestrador.

## Envelope objetivo de long run (L1/L2/L3)

Para reduzir subjetividade, toda long run deve declarar lane ativa e respeitar os gates abaixo.

| Lane | Escopo | Entrada mínima | Até onde vai | Quando parar/voltar |
|------|--------|----------------|--------------|---------------------|
| **L1 — Control-plane only** | execução direta no agente principal, micro-slices | `context_watch` < checkpoint, budget sem BLOCK, board canônico íntegro | até fechar milestone de continuidade sem perguntas óbvias (TASK-BUD-085) | retornar ao usuário só em risco irreversível/conflito de objetivo |
| **L2 — Subagentes assistidos** | delegação limitada para investigação/implementação | L1 estável + `subagent_readiness_status(strict=true)` passando | até provar ganho de throughput com governança preservada (sem regressão de HITL) | qualquer falha de readiness/governança força fallback para L1 |
| **L3 — Swarm supervisionado** | colônia com preflight e budget envelope explícitos | L2 estável + preflight/swarm governance em verde + baseline curada | até milestone de entrega com evidência determinística (delivery/recovery) | BLOCK de budget, falha de preflight ou evidência insuficiente => fallback L2 |

### Stop conditions obrigatórias por lane

1. **Budget BLOCK/WARN crítico** sem rota segura de handoff.
2. **Contexto em checkpoint/compact** sem handoff recente.
3. **Gate de governança quebrado** (`project-validate` não clean, preflight falhando, readiness estrito reprovado).
4. **Sinal de confiança quebrada**: usuário pede pausa/interrupção ou objetivo fica ambíguo.

### Contrato de sugestão de escala

A lane simples (L1/control-plane) permanece default. Sugerir L2/L3 só quando houver sinal objetivo e comunicável:

- **contexto**: janela próxima de checkpoint/compact ou tarefa extensa que preserva melhor progresso via handoff/subagente;
- **backlog**: múltiplos itens independentes com validações focais claras;
- **readiness**: `subagent_readiness_status(strict=true)` passa e preflight/swarm governance está verde para L3;
- **custo**: quota/provider sem WARN/BLOCK e orçamento explícito para execução paralela.

Toda sugestão de escala deve dizer em uma frase: motivo, lane proposta, limite de custo/escopo e fallback para L1.
Sem esse conjunto mínimo — ou sem pedido explícito do usuário — continuar em L1 com slices bounded.

Caminho curto de redução/interrupção:
- usuário pode pedir “pausar”, “voltar para L1”, “sem subagentes/colônia” ou “só board/local”;
- o control-plane registra checkpoint/handoff curto, cancela novos lançamentos e preserva progresso já validado;
- falha de readiness/governança/custo rebaixa automaticamente para L1 sem tentar compensar com mais paralelismo.

### Próximo marco de calibração/autonomia (objetivo)

Long run atual vai até cumprir este pacote mínimo:

- `TASK-BUD-085` (no-obvious-questions) com evidência de autonomia pragmática;
- `TASK-BUD-091` + `TASK-BUD-092` (baseline curada + parity hard gate);
- `TASK-BUD-086` + `TASK-BUD-096` (promoção L1->L2 com readiness strict estável);
- critérios de rollback documentados e testados para manter regressão sob controle.

## Referências de operação

| Recurso | Uso |
|---------|-----|
| [`swarm-cleanroom-protocol.md`](./swarm-cleanroom-protocol.md) | **Protocolo de execução** — pré/pós-run, promoção, reconciliação |
| [`mini-handoff-template.md`](./mini-handoff-template.md) | Modelo padrão para checkpoints de contexto em micro-lotes |
| [`budget-governance.md`](./budget-governance.md) | Budget envelope e governança de custo |
| [`quota-visibility.md`](./quota-visibility.md) | Como auditar consumo e detectar WARN/BLOCK |
| [`provider-readiness`](/provider-matrix) | Verificar saúde de providers antes de lançar swarm |
| `.project/tasks.json` | Board canônico — fonte de verdade versionada |
| `.project/requirements.json` | Requisitos que fundamentam as tasks |
| `.project/decisions.json` | Decisões já tomadas — não reabrir sem evidência nova |
