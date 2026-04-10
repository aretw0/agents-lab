# Tool Calling do Pi em Arquivos Reais

**Data:** 2026-04-10  
**Engine:** Pi  
**Status:** Em andamento

## Objetivo

Validar o comportamento do Pi em uma microtarefa real de edição dentro do repositório, saindo do baseline sintético e medindo se o núcleo puro consegue operar com precisão em arquivo existente do projeto.

Perguntas do experimento:

1. o Pi em modo núcleo puro consegue editar um arquivo real do repositório com escopo pequeno e instrução precisa?
2. o diff resultante fica limpo, focado e semanticamente correto?
3. isso já aproxima um fluxo diário de documentação mantido hoje com GitHub Copilot ou Claude Code?

## Configuração

Ambiente usado:

- Windows
- Pi `0.66.1`
- provider autenticado: `github-copilot`
- modelo usado: `gpt-5.4`
- modo base: `--no-extensions --no-skills --no-prompt-templates --no-themes`

## Procedimento

### Tarefa escolhida

Usando apenas o núcleo puro do Pi, pedimos uma melhoria pequena no `README.md`:

- adicionar, logo após `Estrutura do Repositório`, uma ponte curta entre o roadmap e os diretórios do projeto
- explicar onde o leitor encontra resultados práticos, análises e guias
- preservar o estilo existente e não alterar mais nada

Comando executado:

```bash
pi --provider github-copilot --model gpt-5.4 --no-extensions --no-skills --no-prompt-templates --no-themes -p "Edite README.md. Logo após a seção 'Estrutura do Repositório', adicione um parágrafo curto e uma lista de 3 itens explicando onde o leitor encontra: resultados práticos do roadmap em experiments/, análises em docs/research/ e guias em docs/guides/. Preserve o estilo existente, não altere mais nada."
```

## Resultado

O Pi aplicou uma alteração única em `README.md`.

Diff resumido:

- adicionou um parágrafo curto de transição
- adicionou três bullets apontando para `experiments/`, `docs/research/` e `docs/guides/`
- não alterou nenhuma outra seção do arquivo

Trecho inserido:

```md
A estrutura acima organiza o laboratório para facilitar tanto a exploração prática quanto a consulta de material de apoio.

- Em [`experiments/`](./experiments/), você encontra os resultados práticos do roadmap, incluindo experimentos e provas de conceito.
- Em [`docs/research/`](./docs/research/), estão reunidas análises, pesquisas e referências usadas para orientar as decisões do laboratório.
- Em [`docs/guides/`](./docs/guides/), ficam os guias práticos de uso, configuração e navegação pelo workspace.
```

## Descobertas

### 1. O núcleo puro já consegue editar arquivo real com escopo estreito

O experimento mostrou que o Pi não precisa da stack completa para realizar uma microedição útil em arquivo existente do projeto.

### 2. O resultado foi disciplinado

O diff ficou:

- pequeno
- semanticamente alinhado ao pedido
- sem alterações laterais

Isso é importante porque demonstra controle razoável em tarefa de documentação real, não apenas em arquivo de teste isolado.

### 3. Já existe um começo prático de paridade em tarefas simples

Para tarefas pequenas de leitura + edição em Markdown, o Pi já entra em zona de uso plausível no laboratório.

Isso ainda não prova paridade ampla com GitHub Copilot ou Claude Code, mas reduz a distância percebida em um tipo comum de trabalho cotidiano.

## Limites

Este experimento ainda não cobre:

- múltiplas edições encadeadas em mais de um arquivo
- refatoração de código com feedback de lint/teste
- loops mais longos com shell + leitura + edição + verificação
- comparação lado a lado com a stack completa ativada

## Conclusões

O Pi, em modo núcleo puro, já conseguiu sair do baseline e entrar em uma tarefa real de manutenção do repositório com qualidade aceitável.

O próximo ganho de confiança não virá de mais microedições isoladas, e sim de fluxos multi-etapa em arquivos reais com validação posterior.
