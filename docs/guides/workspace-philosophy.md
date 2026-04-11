# Filosofia de Workspace no agents-lab

## Contexto

No laboratório, o workspace não é apenas um diretório onde arquivos aparecem. Ele é a superfície concreta onde intenção, execução, memória e colaboração se encontram.

Quando trabalhamos com agentes, extensões e ferramentas opinativas, o workspace passa a refletir decisões arquiteturais em tempo real. Isso inclui:

- arquivos criados para orientar o agente
- diretórios gerados por extensões
- caches, monitores e configurações projetadas no projeto
- artefatos que ajudam humanos e agentes a permanecerem conectados ao que estão fazendo enquanto fazem

## Princípio Central

O laboratório não quer controlar o workspace de ninguém. Quer entendê-lo.

Essa diferença importa.

Controlar o workspace cedo demais tende a congelar uma forma de trabalho antes de entendermos sua necessidade real.

Entender o workspace significa:

1. observar o que as ferramentas materializam
2. distinguir intenção de efeito colateral
3. decidir o que deve virar convenção compartilhada
4. manter o ambiente legível tanto para agentes quanto para seres humanos

## O Workspace como Interface Viva

Para o laboratório, o workspace cumpre ao menos quatro papéis ao mesmo tempo:

### 1. Superfície operacional

É onde agentes e ferramentas atuam.

Exemplos:

- edição de arquivos
- geração de diretórios auxiliares
- criação de configurações locais
- persistência de estado de execução

### 2. Superfície cognitiva

É onde o trabalho continua visível para quem participa.

Um bom workspace ajuda a responder perguntas como:

- o que está sendo feito agora?
- por que este arquivo existe?
- este diretório é parte do projeto ou apenas estado gerado?
- o que deve ser lido por um humano e o que deve ser consumido por uma ferramenta?

### 3. Superfície social

Mesmo quando só uma pessoa está trabalhando, o workspace já está sendo preparado para colaboração futura.

Isso vale para:

- outros humanos
- agentes futuros
- extensões que ainda nem existem
- primitivas que o próprio laboratório venha a criar

### 4. Superfície de design

O que entra no workspace molda a forma de pensar e trabalhar.

Se um agente depende de certos arquivos, pastas ou convenções para operar bem, isso não é detalhe de implementação. Isso é design de interface de trabalho.

## Heurística para Artefatos no Workspace

Quando uma ferramenta criar algo no repositório, a primeira reação do laboratório não deve ser aceitar nem apagar automaticamente.

Deve ser classificar.

Perguntas úteis:

1. este artefato expressa intenção de projeto ou apenas estado de execução?
2. ele melhora legibilidade e colaboração ou apenas acumula ruído?
3. ele deve ser versionado, ignorado, reconfigurado ou estudado?
4. ele serve apenas à ferramenta atual ou pode se tornar uma convenção valiosa do laboratório?

## Tipos de Artefato

### 1. Artefato intencional de projeto

Deve tender ao versionamento.

Exemplos plausíveis:

- instruções compartilhadas
- configuração estável do workspace
- arquivos que definem comportamento esperado de agentes
- estrutura projetada para colaboração humana + agente

### 2. Artefato operacional gerado

Deve tender a ignore ou tratamento especial.

Exemplos plausíveis:

- cache
- telemetria local
- baseline efêmera
- estado transitório de sessão

### 3. Artefato ambíguo

Deve virar objeto de investigação.

Esse é o caso mais interessante para o laboratório, porque geralmente indica uma fronteira ainda não resolvida entre runtime, projeto e colaboração.

## Caso Pi

A validação prática do Pi mostrou exatamente essa tensão.

Extensões da stack materializaram:

- `.pi/monitors/`
- `.pi-lens/cache/`

Esse comportamento não deve ser lido nem como bug automático nem como convenção automática.

Deve ser lido como sinal de que o workspace é parte da interface do ecossistema Pi.

No laboratório, a resposta correta é:

1. observar
2. localizar a origem
3. entender a intenção
4. decidir conscientemente o destino desse artefato

## Implicação para o agents-lab

O laboratório deve manter duas capacidades ao mesmo tempo:

- abertura para ferramentas opinativas materializarem novas formas de trabalho
- rigor para não confundir qualquer artefato gerado com convenção legítima

Isso nos ajuda a preservar o que importa:

- legibilidade
- colaboração
- continuidade
- consciência do trabalho enquanto ele acontece

## Conclusões

- Workspace não é só infraestrutura; é parte da experiência cognitiva e colaborativa do laboratório.
- Entender o workspace é mais importante do que controlá-lo cedo demais.
- Ferramentas que escrevem no projeto estão propondo formas de trabalho; isso deve ser estudado.
- O laboratório deve transformar artefatos ambíguos em objeto de pesquisa, não em ruído descartado por reflexo.
