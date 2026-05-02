# Primitive Proposal Template

Template canônico para propor uma nova primitiva sem inflar a stack com abstrações prematuras.

## 1) Problema recorrente (obrigatório)

- **Problema**:
- **Onde se repete hoje** (arquivos/superfícies):
- **Frequência** (quantas vezes apareceu):
- **Custo atual** (tempo, erro, complexidade):

> Sem recorrência comprovada, a proposta deve ser `defer`.

## 2) Contrato mínimo da primitiva

- **Nome proposto**:
- **Categoria** (planejamento/governança/execução/observabilidade/etc.):
- **Entrada mínima**:
- **Saída mínima**:
- **Invariantes** (ex.: read-only, dispatchAllowed=false):
- **Stop conditions**:

## 3) Reuso e consolidação

- **Primitivas/trechos existentes reutilizados**:
- **Código duplicado que será removido/consolidado**:
- **Impacto esperado em simplicidade**:

## 4) Segurança e rollback

- **Escopo** (local-safe/protected):
- **Riscos principais**:
- **Plano de rollback não-destrutivo**:
- **Condição de fail-closed**:

## 5) Validação e observabilidade

- **Teste crítico de contrato**:
- **Teste de regressão**:
- **Evidência no board/verification**:
- **Métrica de sucesso**:

## 6) Decisão recomendada

- `promote` — quando recorrência, contrato e validação estão claros.
- `defer` — quando faltar recorrência, contrato ou segurança.
- `reject` — quando a proposta só duplica capability existente.

## 7) Checklist de GO/NO-GO

### GO
- [ ] recorrência comprovada;
- [ ] contrato mínimo definido;
- [ ] smoke/regressão definidos;
- [ ] rollback explícito;
- [ ] evidência de consolidação de duplicação.

### NO-GO
- [ ] proposta sem owner;
- [ ] nova superfície sem teste;
- [ ] alteração protected sem decisão humana;
- [ ] custo operacional maior que o benefício esperado.
