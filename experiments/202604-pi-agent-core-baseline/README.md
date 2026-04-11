# Baseline do pi-agent-core via CLI

**Data:** 2026-04-10  
**Engine:** Pi  
**Status:** Concluído

## Objetivo

Validar a camada mais básica utilizável do ecossistema Pi no ambiente real do laboratório, isolando o núcleo do agente das extensões, monitores, skills e prompt templates.

Este experimento existe para responder:

1. o CLI atual já entrega um baseline operacional próximo do que esperamos de um agente de código?
2. o núcleo puro consegue ler, escrever e usar shell sem depender da stack opinativa instalada?
3. quais atritos de uso aparecem no Windows/PowerShell antes mesmo de entrarmos em primitivas próprias?

## Configuração

Ambiente usado:

- Windows
- Pi `0.66.1`
- provider autenticado: `github-copilot`
- modelo usado: `gpt-5.4`
- modo base: `--no-extensions --no-skills --no-prompt-templates --no-themes`

O experimento foi executado diretamente pelo CLI do Pi, que neste ambiente depende de `@mariozechner/pi-agent-core@0.66.1`.

## Procedimento

### 1. Leitura contextual em modo núcleo

Comando usado:

```bash
pi --provider github-copilot --model gpt-5.4 --no-extensions --no-skills --no-prompt-templates --no-themes -p "Leia ROADMAP.md e resuma apenas a Fase 2 em no máximo 4 linhas."
```

Resultado:

- leitura contextual do workspace funcionou
- o agente resumiu corretamente a Fase 2

### 2. Escrita mínima em área dedicada de experimento

Comando usado:

```bash
pi --provider github-copilot --model gpt-5.4 --no-extensions --no-skills --no-prompt-templates --no-themes -p "Crie o arquivo experiments/202604-pi-agent-core-baseline/smoke.txt com o conteúdo exato: pi-agent-core smoke test"
```

Resultado:

- o arquivo `smoke.txt` foi criado com sucesso
- o conteúdo gravado foi exatamente `pi-agent-core smoke test`

### 3. Bash tool em modo núcleo

Comando usado:

```bash
pi --provider github-copilot --model gpt-5.4 --no-extensions --no-skills --no-prompt-templates --no-themes -p "Use bash para imprimir o diretório atual e depois pare."
```

Resultado:

- o agente executou `bash` com sucesso
- retornou o diretório atual em formato compatível com Git Bash no Windows

### 4. Read-only explícito com tools limitadas

Comando usado:

```bash
pi --provider github-copilot --model gpt-5.4 --no-extensions --no-skills --no-prompt-templates --no-themes --tools "read,grep,find,ls" -p "Liste os arquivos markdown dentro de docs e experiments sem modificar nada."
```

Resultado:

- o agente listou corretamente os arquivos Markdown em `docs/` e `experiments/`
- não houve modificação no workspace

## Descobertas

### 1. O núcleo puro já é utilizável para fluxo básico de agente

Mesmo sem extensões, skills, themes ou prompt templates, o Pi já entregou:

- leitura contextual
- escrita de arquivo
- execução de shell
- modo read-only com tools explicitamente limitadas

Isso significa que a base operacional do agente não depende da stack opinativa usada nos experimentos anteriores.

### 2. O atrito principal aqui não foi o runtime, foi ergonomia de CLI no PowerShell

Ao testar `--tools`, apareceu um detalhe importante no Windows:

- em PowerShell, a lista de tools precisa ser passada entre aspas, por exemplo `--tools "read,grep,find,ls"`

Sem isso, a lista pode ser interpretada como array pelo shell e chegar ao Pi como string inválida.

Esse detalhe é pequeno, mas relevante para adoção real e para qualquer documentação futura de onboarding em Windows.

### 3. O experimento reduz a incerteza sobre a camada base do ecossistema

Depois da investigação pesada de `pi-project-workflows`, este baseline mostra que o problema anterior não era “o Pi como núcleo não serve”.

A leitura mais precisa agora é:

- o núcleo base funciona
- a stack adicional traz capacidades úteis, mas também complexidade e comportamento opinativo
- a avaliação de paridade com GitHub Copilot ou Claude Code precisa separar claramente núcleo, extensões e convenções de workspace

## Limites do experimento

Este baseline ainda não cobre:

- fluxos longos com múltiplas etapas de tool calling
- uso intensivo de edição/refatoração em arquivos reais do projeto
- múltiplos providers de LLM
- subagents
- A2A
- web access remoto

## Conclusões

O laboratório já pode tratar o Pi, em modo núcleo, como uma base operacional real para leitura, escrita e shell.

Isso não significa paridade com GitHub Copilot ou Claude Code, mas reduz uma incerteza central: o caminho para paridade não começa do zero. Ele começa de uma base que já funciona, e o trabalho restante está mais em ergonomia, composição de extensões, qualidade de workflow e cobertura de casos complexos.

## Próximos passos

1. isolar um experimento dedicado de tool calling com múltiplos passos e arquivos reais
2. comparar o mesmo fluxo com e sem extensões ativas
3. medir onde o ganho da stack supera o custo de complexidade operacional
