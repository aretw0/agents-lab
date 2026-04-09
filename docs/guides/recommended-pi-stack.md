# Stack Recomendada de Pi para o agents-lab

## Objetivo

Definir uma stack mínima e coerente para começar a usar Pi sem cair em instalação aleatória de pacotes sobrepostos.

## Princípio

Começar com uma composição pequena, validável e reversível.

## Camada 1 — Base operacional

### Opção recomendada

```bash
npx @ifi/oh-pi
```

Razão:

- oferece bootstrap mais rápido do ecossistema
- resolve utilidades operacionais de alto valor logo de início
- serve como baseline concreto para comparação futura

Recursos mais relevantes para o laboratório:

- `git-guard`
- `auto-session-name`
- `custom-footer`
- `compact-header`
- `/spec`

`ant-colony` pode ficar desabilitado no começo, já que multi-agente ainda é área de comparação e não de adoção fechada.

## Camada 2 — Workflow e project state

```bash
pi install npm:@davidorex/pi-project-workflows
```

Razão:

- adiciona estrutura forte para project state, workflows e monitores
- conversa bem com nossa necessidade de pesquisa organizada e evolução incremental

Uso recomendado inicial:

- explorar `pi-project` e `pi-workflows`
- adotar só o que reduzir atrito real
- evitar modelar tudo cedo demais

## Camada 3 — Qualidade de código inline

```bash
pi install npm:pi-lens
```

Razão:

- feedback em tempo real durante sessões: lint, type-check, formatação, testes e segurança
- auto-instala dependências de análise baseado no contexto do projeto
- delta reporting reduz ruído de issues legacy
- comandos `/lens-booboo` e `/lens-health` para visibilidade

Sem pi-lens, o agente é cego para erros até que checks manuais sejam executados.

## Camada 4 — Pesquisa e utilitários complementares

```bash
pi install npm:pi-web-access
```

Razão:

- web search e fetch são centrais para a fase atual do laboratório

Pacotes a avaliar depois, não no primeiro dia:

- `@ifi/pi-extension-subagents`
- `@0xkobold/pi-orchestration`
- uma solução de memória entre `memex`, `pi-memory` e `pi-brain`

## Camada 5 — Desenvolvimento de extensões

Quando entrarmos na fase de construção própria:

```bash
npm install --save-dev @marcfargas/pi-test-harness
```

Razão:

- permite testar extensões em ambiente Pi real sem depender de LLM real

## Ordem Recomendada de Adoção

1. instalar Pi
2. instalar `oh-pi`
3. instalar `pi-lens`
4. validar fluxo básico de uso
5. adicionar `pi-project-workflows`
6. adicionar `pi-web-access`
7. testar categorias ambíguas uma a uma

## O Que Evitar no Início

- instalar muitos pacotes de multi-agente ao mesmo tempo
- instalar múltiplas soluções de memória sem critério
- abrir uma trilha de extensões próprias antes de validar a stack mínima

## Conclusão

Hoje a stack recomendada é:

1. `@mariozechner/pi-coding-agent`
2. `@ifi/oh-pi`
3. `pi-lens`
4. `@davidorex/pi-project-workflows`
5. `pi-web-access`
6. `@marcfargas/pi-test-harness` quando a fábrica começar
