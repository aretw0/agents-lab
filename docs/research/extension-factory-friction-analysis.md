---
created: 2026-04-09
status: draft
---

# Análise de Fricções da Fábrica de Extensões Pi

## Contexto

Antes de investir em extensões in-house, precisamos entender onde o processo de criação realmente dói. Sem isso, a chance é construir uma fábrica elegante para resolver dores erradas.

## Metodologia

As fricções abaixo foram inferidas a partir dos repositórios analisados, do modelo de distribuição do Pi e do estado atual do laboratório.

## Fricções Principais

### 1. Bootstrap do ambiente

Hoje o Pi ainda nem está instalado neste ambiente. Isso já sinaliza um tipo de fricção estrutural: o caminho de pesquisa e o caminho de uso ainda estão separados.

Consequência:

- decisões sobre extensões ainda não podem ser validadas no chão da operação

### 2. Boilerplate inicial

Criar extensão demanda:

- metadata correta de pacote
- entrypoint compatível
- entendimento do SDK e do ciclo de vida
- configuração de build

Para uma extensão muito pequena, esse custo pode parecer grande demais.

Leitura prática:

- a factory precisa reduzir o custo de arrancada
- mas isso só vale a pena depois do primeiro ou segundo pacote real

### 3. Testing realista

Sem ferramenta dedicada, testar extensões Pi tende a ser caro e artificial. Esse é exatamente o tipo de problema que leva times a subtestar integrações.

`pi-test-harness` reduz muito essa fricção, então esta dor já tem solução promissora no ecossistema.

### 4. Publicação e versionamento

Toda fábrica séria esbarra em:

- naming
- scope
- versionamento
- compatibilidade com versões do Pi
- publicação npm

Para o laboratório, isso sugere adiar o tema até existir ao menos um pacote maduro o suficiente para ser publicado.

### 5. Overlap do ecossistema

Existe uma fricção cognitiva forte causada pela abundância:

- muitas soluções para web search
- muitas soluções para subagentes
- muitas soluções para memória
- muitos bundles opinativos

Isso torna difícil responder com segurança: "devemos adotar, adaptar ou substituir?"

### 6. Falta de critérios operacionais unificados

Sem scorecard e sem taxonomia, a escolha de extensões tende a virar preferência estética ou hype momentâneo.

Essa fricção é justamente o que a documentação criada nesta iteração começa a reduzir.

### 7. Meta-fricção: o Pi ainda não constrói a própria fábrica para nós

A visão mais interessante de longo prazo é usar o próprio Pi para:

- scaffoldar extensões
- testar extensões
- publicar extensões
- gerar skills e prompts derivados de uso real

Isso ainda existe no ecossistema apenas de forma parcial e fragmentada.

## Fricções por Momento de Maturidade

| Momento | Fricção dominante |
|---------|-------------------|
| Agora | descoberta e curadoria |
| Primeira adoção | instalação, configuração e escolha mínima viável |
| Primeira extensão própria | boilerplate e testes |
| Escala | versionamento, publicação e compatibilidade |

## O Que Fazer com Isso

### Agora

- documentar o mapa do ecossistema
- escolher uma stack mínima viável
- instalar Pi e validar a stack no uso real

### Depois

- padronizar template mínimo de extensão
- padronizar testes com `pi-test-harness`
- só então discutir repo separado de extensões

## Conclusões

- A maior fricção atual não é técnica, é de curadoria.
- A maior fricção futura será manter consistência entre pacotes próprios se começarmos a publicar cedo demais.
- A fábrica de extensões deve nascer depois da validação prática da stack, não antes.

## Referências

- [pi.dev/packages](https://pi.dev/packages)
- [marcfargas/pi-test-harness](https://github.com/marcfargas/pi-test-harness)
- [ifiokjr/oh-pi](https://github.com/ifiokjr/oh-pi)
