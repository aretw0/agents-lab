# Investigação do Monitor Hedge no Pi

**Data:** 2026-04-10  
**Engine:** Pi  
**Status:** Em andamento

## Objetivo

Entender o comportamento do monitor `hedge` introduzido pela stack `@davidorex/pi-project-workflows`, sem tratá-lo como ruído a ser removido por reflexo.

Este experimento existe para responder quatro perguntas:

1. o que o `hedge` tenta fazer?
2. como ele entra no workspace?
3. por que ele falha no nosso ambiente atual?
4. essa falha revela uma expectativa válida do ecossistema ou um acoplamento inadequado?

## Configuração

Contexto do ambiente:

- Pi `0.66.1`
- provider autenticado no fluxo principal: `github-copilot`
- pacote instalado: `@davidorex/pi-project-workflows@0.14.4`
- pacote transitivo relevante: `@davidorex/pi-behavior-monitors@0.14.4`

Reprodução mínima usada:

```bash
pi --provider github-copilot --model gpt-5.4 --no-tools -p "Responda exatamente: OK"
```

Resultado observado:

```text
OK
[hedge] classify failed: No tool call in response (stopReason: error, content: [] error: Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted)
```

## Descobertas

### 1. O hedge é um sensor de `turn_end`

O monitor projetado no workspace foi materializado em `.pi/monitors/hedge.monitor.json` com a seguinte intenção:

- nome: `hedge`
- descrição: detectar quando o assistant desvia do que o usuário disse
- evento: `turn_end`
- escopo: `main`
- ação: injetar steering quando houver flag ou padrão novo

Isso mostra que o `hedge` não é um detalhe cosmético. Ele é uma camada de correção comportamental pós-resposta.

### 2. O monitor usa um agente classificador dedicado

O arquivo `hedge-classifier.agent.yaml`, dentro do pacote `@davidorex/pi-behavior-monitors`, define:

- `name: hedge-classifier`
- `role: sensor`
- `description: Classifies whether assistant deviated from user intent`
- `model: claude-sonnet-4-6`

O prompt de classificação compara:

- pedido do usuário
- resultados de tools
- resposta mais recente do assistant
- padrões conhecidos de desvio

Ou seja: a intenção do componente é legítima e sofisticada. Ele tenta proteger aderência à intenção do usuário.

### 3. O monitor entra no workspace como artefato opinativo de projeto

Na validação real, o pacote projetou em `.pi/monitors/`:

- `hedge.monitor.json`
- `hedge.patterns.json`
- `hedge.instructions.json`
- `hedge/classify.md`

Isso reforça a hipótese já registrada no laboratório: extensões Pi podem usar o workspace como superfície de configuração e comportamento compartilhado.

### 4. Causa técnica atualmente mais forte

Aqui a investigação saiu do nível de sintoma e chegou ao código do pacote.

No bundle compilado de `@davidorex/pi-behavior-monitors`, a função `parseModelSpec()` faz exatamente isto:

```ts
if (spec contains "/") {
  return { provider, modelId }
}
return { provider: "anthropic", modelId: spec }
```

Ao mesmo tempo, o `hedge-classifier.agent.yaml` define apenas:

```yaml
model: claude-sonnet-4-6
```

Sem provider explícito.

Como o nosso fluxo principal autenticado está em `github-copilot`, a leitura técnica mais forte agora é:

1. o classificador do `hedge` não herda automaticamente o provider do fluxo principal
2. o pacote interpreta modelos sem prefixo como `anthropic/<model>`
3. a chamada auxiliar falha porque não há autenticação Anthropic configurada neste ambiente

Isso combina exatamente com o erro observado:

```text
Could not resolve authentication method. Expected either apiKey or authToken to be set.
```

Portanto, neste estágio da investigação, a hipótese principal deixou de ser apenas inferência comportamental e passou a ter suporte direto no código do pacote.

### 5. Hipótese validada com override local de workspace

Depois da análise do loader de agent specs, encontramos a ordem de busca usada por `createAgentLoader()`:

1. `.pi/agents/<name>.agent.yaml` no projeto
2. `~/.pi/agent/agents/<name>.agent.yaml` no usuário
3. `agents/<name>.agent.yaml` do pacote

Com isso, foi criado no projeto um override local em:

- `.pi/agents/hedge-classifier.agent.yaml`

Alteração aplicada no experimento:

- antes: `model: claude-sonnet-4-6`
- depois: `model: github-copilot/claude-sonnet-4.6`

Após esse override, a mesma reprodução mínima passou a responder apenas:

```text
OK
```

Sem o erro auxiliar de autenticação do `hedge`.

Isso confirma a leitura causal mais forte deste experimento:

- o problema estava na resolução implícita de provider
- o monitor não herdava automaticamente o provider do fluxo principal
- um artefato local em `.pi/agents/` consegue reconfigurar o comportamento de forma limpa

## O que este experimento ainda não conclui

Ainda não concluímos:

- se o pacote espera alguma configuração adicional do usuário
- se há fallback automático de provider e ele está escolhendo um backend incompatível
- se o comportamento é bug, limitação conhecida ou trade-off deliberado do pacote
- se essa solução deve ser tratada como workaround local ou convenção legítima do laboratório

## Implicações para o laboratório

Este caso é valioso por três razões:

1. mostra como um pacote pode embutir uma filosofia de correção comportamental
2. mostra como essa filosofia se materializa no workspace
3. mostra como um erro auxiliar pode revelar um desacoplamento imperfeito entre runtime principal e sensores secundários

O aprendizado central aqui não é “desabilitar hedge”.

É reconhecer que o laboratório precisa aprender a ler monitores, sensores e artefatos auxiliares como parte do design do ecossistema.

Também é o primeiro caso claro em que um arquivo dentro de `.pi/` deixa de ser apenas artefato ambíguo e passa a funcionar como configuração intencional de projeto.

## Próximos passos

1. descobrir se existe configuração suportada pelo pacote para alinhar sensores ao provider autenticado principal sem override local
2. decidir se o comportamento é bug, limitação de design ou convenção deliberada do pacote
3. decidir se `.pi/agents/hedge-classifier.agent.yaml` deve permanecer como artefato versionado do laboratório
4. usar o caso como referência para futuras decisões sobre `.pi/` como superfície de projeto
