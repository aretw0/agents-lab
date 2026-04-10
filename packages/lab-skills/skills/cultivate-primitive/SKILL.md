---
name: cultivate-primitive
description: >
  Guia o cultivo de uma primitiva reutilizável. Use quando o usuário identificar
  um padrão recorrente que merece ser extraído como skill, extensão ou convenção.
---

# Cultivar uma Primitiva

Uma primitiva é um bloco reutilizável que resolve um problema recorrente no trabalho com agentes. Este skill guia o processo de identificação, experimentação e formalização.

## Quando Usar

- Um padrão aparece em mais de um contexto
- Uma solução ad hoc se repetiu 3+ vezes
- O usuário diz "seria bom se o pi soubesse fazer X sempre"

## Processo

### 1. Nomear e Descrever

Pergunte ao usuário:

- **O que** esta primitiva resolve?
- **Quando** ela é necessária?
- **Como** funciona hoje (de forma manual ou improvisada)?

### 2. Classificar a Forma

| Forma | Quando usar |
|---|---|
| **Skill** | Instruções recorrentes que o agente segue |
| **Extension** | Hooks, tools, UI ou estado persistente |
| **Prompt template** | Atalho para prompts frequentes |
| **Convenção** | Estrutura de diretório, naming, padrão de arquivo |
| **Monitor** | Comportamento que precisa ser observado e corrigido |

### 3. Experimentar

Crie um experimento em `experiments/YYYYMM-nome-descritivo/`:

```bash
mkdir -p experiments/$(date +%Y%m)-nome-do-experimento
```

Documente:
- Hipótese
- Setup
- Resultado
- Decisão (promover, iterar, ou descartar)

### 4. Formalizar

Se o experimento é positivo:

1. Criar o artefato (skill, extensão, etc.) em `packages/`
2. Adicionar ao `.pi/settings.json` do projeto
3. Testar com `/reload`
4. Documentar a proveniência e as decisões no README do pacote

### 5. Solicitar Feedback

Se a primitiva é para a stack (`@aretw0/pi-stack`):

- Criar PR com a mudança
- Descrever o problema que resolve
- Incluir antes/depois quando possível
- Solicitar review do maintainer

## Anti-padrões

- Primitiva que resolve um problema que só apareceu uma vez
- Abstração prematura — espere pelo terceiro caso
- Skill gigante que mistura várias preocupações
- Extensão onde uma skill bastaria
