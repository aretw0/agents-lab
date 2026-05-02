# Semantic paging context strategy 2026 (local-first + auditável)

Referência: `TASK-BUD-627`.
Objetivo: reduzir custo de contexto sem perder continuidade, foco e governança.

## 1) Relação com o stack atual (context-watch / handoff / checkpoint)

## Context-watch
- já classifica pressão de contexto (`ok|warn|checkpoint|compact`);
- semantic paging entra como camada de **economia de contexto** antes de compact forçada;
- uso recomendado: quando `checkpoint` aproximar `compact`, priorizar síntese paginada em vez de expansão textual longa.

## Handoff
- handoff continua fonte canônica de continuidade;
- semantic paging deve gerar blocos curtos por prioridade (foco, validação, blockers, next);
- evitar payload verboso que causa truncation no auto-resume.

## Checkpoint
- checkpoint vira ponto de corte da paginação: cada slice gera páginas curtas e estáveis;
- páginas antigas podem ser resumidas em “macro-page” sem perder rastreabilidade de decisão.

## 2) Métricas de sucesso

1. **tokens/custo**
   - redução de tokens médios por retomada;
   - redução de custo por ciclo sem queda de qualidade.

2. **taxa de retomada correta**
   - % de retomadas que seguem foco/ordem esperada sem desvio;
   - % de retomadas sem necessidade de correção humana imediata.

3. **regressões de foco**
   - queda de mudanças de tarefa não intencionais;
   - queda de perda de steer no último turno pré-compact.

## 3) Estratégia operacional (sem forcing)

- manter semantic paging inicialmente em **report-only**;
- nenhuma mudança automática de execução/proteção;
- inserir apenas recomendações de formatação e compactação de contexto em checkpoints.

## 4) Experimento local-safe bounded (pré-adoção estrutural)

### Nome
`semantic-paging-report-only-v1`

### Escopo
- 3 a 5 slices locais de baixa/média complexidade;
- sem escopo protegido;
- arquivos e gate de validação declarados por slice.

### Procedimento
1. baseline: registrar tamanho/estrutura de handoff atual;
2. aplicar modelo paginado curto (focus/validation/blockers/next);
3. comparar retomada e custo por slice;
4. registrar evidência no board/verification.

### Gate de validação
- `context_watch_auto_resume_preview` sem truncation crítica de next_actions;
- foco preservado entre slices;
- smoke focal verde (quando aplicável).

### Rollback
- remover formato paginado e voltar ao checkpoint padrão anterior;
- manter histórico auditável dos experimentos já executados.

## 5) Critérios para avançar

Promover para experimentos mais amplos apenas se:
- ganhos de tokens/custo forem consistentes,
- retomada correta melhorar ou se manter,
- não houver regressão de foco/governança.

## 6) Conclusão

Semantic paging pode ser forte alavanca de produtividade, mas só é sustentável com disciplina de continuidade:
checkpoint curto, handoff canônico, e validação de retomada antes de qualquer mudança estrutural.
