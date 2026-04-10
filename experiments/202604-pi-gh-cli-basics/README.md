# Pi + gh CLI: Baseline de Operações GitHub

**Data:** 2026-04-10  
**Engine:** Pi  
**Status:** Em andamento

## Objetivo

Validar o caminho mais pragmático para convergência do Pi como driver principal em fluxos que hoje dependem de GitHub: usar o `gh` CLI como ponte operacional, em vez de assumir uma integração nativa pronta no ecossistema Pi.

Perguntas do experimento:

1. o ambiente já oferece uma superfície operacional viável para Pi + GitHub?
2. o `gh` CLI pode ser instalado e acionado sem depender de privilégios administrativos?
3. qual é a próxima fricção real para paridade: instalação, autenticação ou ergonomia de uso pelo Pi?

## Configuração

Ambiente usado:

- Windows
- Pi `0.66.1`
- provider autenticado para inferência: `github-copilot`
- repositório remoto: `https://github.com/aretw0/agents-lab.git`

## Procedimento

### 1. Verificação inicial do ambiente

Comandos executados:

```powershell
gh --version
gh auth status
```

Resultado:

- `gh` não estava disponível no `PATH`
- portanto, a primeira fricção real não foi o Pi, mas a ausência da interface operacional com GitHub

### 2. Tentativas de instalação padrão

Foi verificado que o ambiente tinha:

- `winget`
- `choco`

Mas as tentativas de instalação padrão não resolveram o problema de forma utilizável na sessão atual:

- `winget` iniciou a instalação, mas o binário não ficou imediatamente disponível
- `choco` falhou por restrições de permissão em diretórios globais

### 3. Instalação local em escopo de usuário

Solução aplicada:

- download do zip oficial do GitHub CLI
- extração em `C:\Users\aretw\AppData\Local\Programs\GitHubCLI`

Binário validado:

```text
C:\Users\aretw\AppData\Local\Programs\GitHubCLI\bin\gh.exe
```

Validação de versão:

```text
gh version 2.89.0 (2026-03-26)
```

### 4. Verificação de autenticação

Comando executado:

```powershell
& 'C:\Users\aretw\AppData\Local\Programs\GitHubCLI\bin\gh.exe' auth status
```

Resultado:

```text
You are not logged into any GitHub hosts. To log in, run: gh auth login
```

### 5. Autenticação usando credencial já existente do git

Em vez de depender de login manual como único caminho, verificamos se o ambiente já tinha credenciais GitHub válidas no helper do git.

Resultado observado:

- o sistema estava com `credential.helper=manager`
- `git credential fill` retornou credencial válida para `github.com`
- essa mesma credencial permitiu autenticar o `gh` de forma não interativa

Validação posterior:

```text
✓ Logged in to github.com account aretw0 (keyring)
```

Isso muda a leitura operacional do experimento:

- o login manual continua sendo uma via importante
- mas o ecossistema local já pode oferecer reaproveitamento controlado de credenciais existentes
- essa ponte só é aceitável quando for explícita e auditável, nunca implícita por padrão

### 6. Read path validado com `gh`

Depois da autenticação, rodamos os primeiros comandos read-only diretamente no GitHub:

```powershell
gh issue list --repo aretw0/agents-lab --limit 10
gh pr list --repo aretw0/agents-lab --limit 10
```

Resultado observado:

- não havia issues abertas no repositório
- não havia pull requests abertas no repositório

O ponto importante não é o conteúdo vazio, e sim o fato de que a leitura do estado remoto funcionou sem atrito adicional.

### 7. Read path validado end-to-end com o Pi

Também validamos o fluxo completo usando o Pi em modo núcleo puro para chamar `gh` via `bash` e interpretar a resposta.

Exemplos de prompts usados:

- pedir ao Pi para executar `gh issue list` e dizer em uma linha o que o comando mostra
- pedir ao Pi para executar `gh pr list` e dizer em uma linha o que o comando mostra

Resultado observado:

- o Pi executou o comando via shell
- leu corretamente o estado retornado pelo GitHub
- resumiu o resultado de forma adequada

Isso fecha o primeiro ciclo de paridade GitHub em modo read-only:

1. utilitário operacional disponível
2. autenticação funcional
3. leitura remota funcional
4. Pi orquestrando o fluxo em cima do `gh`

## Descobertas

### 1. O gap atual de paridade com GitHub não está no provider do Pi

O `github-copilot` já atende à camada de inferência, mas isso não resolve operações do GitHub como:

- issues
- pull requests
- comentários
- status checks
- reviews

Ou seja: provider e operação GitHub são camadas diferentes e precisam ser tratadas separadamente.

### 2. O `gh` CLI é viável como ponte operacional imediata

Mesmo sem admin, foi possível colocar o `gh` em funcionamento em escopo de usuário.

Isso torna o `gh` a opção mais pragmática de curto prazo para o laboratório porque:

- já conversa com o GitHub real
- pode ser chamado pelo Pi via shell/tool calling
- evita desenhar abstrações cedo demais

### 3. A fricção seguinte é autenticação, não instalação

Depois da instalação local, o próximo bloqueio real passou a ser o login no GitHub CLI.

Isso redefine o experimento:

- instalação local: resolvida
- integração GitHub: parcialmente destravada
- autenticação do `gh`: resolvida no ambiente atual com reaproveitamento explícito da credencial do git

### 4. Autenticação operacional deve permanecer isolada da inferência

Este experimento também deixou mais claro um princípio importante para o laboratório:

- autenticação do provider de inferência não deve ser automaticamente tratada como autenticação operacional de utilitários externos

No caso atual:

- `github-copilot` autentica o Pi para inferência
- `gh` autentica operações GitHub concretas

Essas duas camadas até podem convergir no futuro em alguns cenários, mas não devem ser fundidas por padrão.

Razão principal:

1. pode existir necessidade de operar no GitHub com outra conta
2. pode existir necessidade de escopo diferente de permissão
3. uma extensão não deve "herdar sem querer" uma credencial operacional mais forte do que o necessário

Leitura provisória do laboratório:

- default seguro: isolamento entre credencial de inferência e credencial operacional
- extensão futura: só permitir compartilhamento explícito, com opt-in claro e superfície de configuração visível

### 5. Ergonomia inicial: o read path já é plausível

Mesmo sem skill dedicada e sem integração nativa do ecossistema Pi para GitHub, o fluxo Pi + `gh` já mostrou uma propriedade importante:

- para consultas simples de estado remoto, a composição atual já é operacionalmente plausível

O custo cognitivo ainda existe, porque o prompt precisa ser mais explícito do que em superfícies GitHub mais integradas. Mas a distância até uso real ficou menor do que a hipótese inicial sugeria.

## Implicações para o laboratório

Este experimento reforça uma decisão importante:

- curto prazo: Pi + `gh`
- médio prazo: skill ou primitiva só depois de validar fluxos reais repetidos

Também deixa explícito que a convergência para usar o Pi como driver não depende de “esperar o ecossistema maturar sozinho”. Ela depende de compor bem o que já funciona hoje.

Também introduz um princípio transversal para futuras primitivas:

- qualquer utilitário externo com autenticação própria deve começar isolado da credencial do provider
- qualquer ponte entre credenciais deve ser deliberada, reversível e auditável

## Próximos passos

1. comparar o mesmo read path com uma formulação de prompt mais enxuta para medir quanto da ergonomia depende do operador
2. avançar para uma ação de escrita controlada e reversível, como criar uma issue de teste
3. medir a clareza do fluxo Pi + `gh` em comparação com o uso atual do GitHub Copilot
4. discutir em que cenários uma futura integração poderia oferecer extensão opcional de credenciais sem quebrar isolamento entre contas e permissões
