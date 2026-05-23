---
title: Bounded Clarity Rules From Impeccable
description: Short local-safe synthesis of external UX writing and design-quality influence.
---

# Bounded Clarity Rules From Impeccable

Data: 2026-05-22  
Task: `TASK-BUD-468`  
Status: research curta, não promovida para contrato

## Contexto

Esta pesquisa sintetiza uma influência externa de `impeccable.style` em regras práticas para o agents-lab. O objetivo é aproveitar sinais de clareza sem importar lock-in de ferramenta, comando, nomenclatura ou estética.

Referências consultadas:

- Impeccable `/clarify`: foco em texto funcional de interface, labels, botões, erros, empty states, tooltips e confirmações. Fonte: <https://impeccable.style/docs/clarify/>
- Impeccable command model: separa criação, avaliação, refinamento, simplificação, hardening e system commands. Fonte: <https://impeccable.style/docs/>
- Impeccable home command: alerta que a ferramenta é parceira opinativa, não linter; contexto de produto e design orienta decisões. Fonte: <https://impeccable.style/docs/impeccable/>

## Regras Acionáveis

### 1. Escrever para a próxima ação do operador

Aplicação local: comandos, tools, warnings e docs operacionais devem dizer o que aconteceu, o que importa agora e qual é a próxima ação segura.

Risco: transformar todo texto em instrução longa e repetitiva.

Validação focal: `pnpm run repo:discourse:audit` e revisão manual de uma superfície alterada procurando labels vagos como `Submit`, `OK`, `Error` ou `Something went wrong`.

### 2. Separar clareza funcional de voz editorial

Aplicação local: textos de runtime e manutenção devem priorizar precisão e consequência. Personalidade só entra quando não compete com ação, risco ou estado.

Risco: confundir “mais claro” com “mais estiloso” e inflar docs publicadas.

Validação focal: `pnpm run test:docs:site` quando a mudança tocar docs publicadas; smoke específico quando tocar output de runtime.

### 3. Nomear consequência em fluxos destrutivos ou protegidos

Aplicação local: confirmações, gates e approval packets devem nomear o alvo e o efeito da ação, não pedir apenas “tem certeza?”.

Risco: endurecer demais fluxos não destrutivos e criar atrito textual.

Validação focal: teste do surface/packet alterado deve verificar `operatorApproval`, consequência explícita e ausência de mutação quando a aprovação não existe.

### 4. Usar contexto mínimo antes de aplicar opinião externa

Aplicação local: antes de promover padrão visual, textual ou operacional inspirado fora do projeto, registrar público, superfície afetada, risco e rollback.

Risco: transformar pesquisa externa em nova cerimônia obrigatória.

Validação focal: pesquisa fica em `docs/research/` até existir guia pequeno, teste ou primitive que prove uso recorrente; não promover por entusiasmo.

## Decisão

Manter como influência bounded. As regras acima podem orientar revisão de texto e UX de tools, mas não justificam dependência, adoção de comandos externos, mudança automática de escopo protegido ou expansão de workflow.

Próximo passo aceitável: quando uma superfície concreta estiver sendo alterada, usar essas regras como checklist curto de revisão e validar com o menor gate focal aplicável.
