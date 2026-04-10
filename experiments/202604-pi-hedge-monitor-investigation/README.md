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

### 6. A documentação interna do pacote parece desatualizada

Durante a investigação, a skill embutida de `pi-behavior-monitors` descreveu um formato de monitor em que o bloco `classify` teria campos como:

- `classify.model`
- `classify.promptTemplate`
- `classify.prompt`

Mas o schema e o runtime observados no pacote atual trabalham de outra forma:

- o schema exige `classify.agent`
- o runtime exige um `.agent.yaml` separado para resolver modelo, prompt e output schema
- a lógica real de provider/model acontece dentro do carregamento do agent spec

Isso não invalida a utilidade da skill, mas muda sua confiabilidade como fonte única de verdade técnica.

Leitura prática para o laboratório:

1. README/skill do pacote não bastam para entender o comportamento real
2. schema e código compilado precisam entrar na investigação quando houver discrepância
3. a diferença entre documentação declarada e runtime efetivo é, por si só, um achado importante do experimento

### 7. Não encontramos um campo de configuração de provider no monitor

Depois da leitura combinada de README, skill, schema e runtime, não apareceu nenhum mecanismo de primeira classe no formato do monitor para dizer algo como:

- `classify.provider`
- `classify.useCurrentProvider`
- `classify.inheritProvider`

O schema atual do monitor aceita essencialmente:

- `classify.agent`
- `classify.context`
- `classify.excludes`

E o runtime resolve o modelo/provider a partir do `.agent.yaml` carregado pelo agent loader.

Leitura provisória mais forte neste estágio:

- o pacote não parece oferecer, hoje, um campo declarativo no monitor para alinhar sensores ao provider principal
- o mecanismo suportado que efetivamente existe é a resolução por agent spec
- portanto, o override local em `.pi/agents/` não parece um hack acidental; parece usar a superfície de customização que o próprio pacote expõe

### 8. O padrão não parece ser exclusivo do hedge

Depois de inspecionar os artefatos embutidos do pacote, vimos que os cinco monitores de exemplo seguem a mesma arquitetura:

- `commit-hygiene.monitor.json` -> `commit-hygiene-classifier`
- `fragility.monitor.json` -> `fragility-classifier`
- `hedge.monitor.json` -> `hedge-classifier`
- `unauthorized-action.monitor.json` -> `unauthorized-action-classifier`
- `work-quality.monitor.json` -> `work-quality-classifier`

E os cinco agent specs embutidos declaram o mesmo formato de modelo:

```yaml
model: claude-sonnet-4-6
```

Sem provider explícito.

Isso muda a leitura do problema:

1. o `hedge` provavelmente não é um outlier acidental
2. a expectativa de provider implícito parece fazer parte do desenho atual dos classificadores empacotados
3. em ambientes autenticados apenas com `github-copilot`, outros sensores da mesma família podem apresentar a mesma fragilidade se forem ativados

Em outras palavras, o caso `hedge` abriu a porta para um problema mais estrutural: o acoplamento entre sensores auxiliares e resolução implícita de provider pode atravessar a extensão inteira, não apenas um monitor específico

### 9. O changelog ainda não explica essa escolha

O `CHANGELOG.md` do pacote registra evoluções de runtime, comandos e integração no monorepo, mas não traz uma nota explícita sobre:

- migração de `classify.model` para `classify.agent`
- política de herança ou não herança de provider
- interpretação de modelos sem prefixo

Isso não prova erro, mas reduz nossa capacidade de tratar o comportamento como convenção documentada. Até aqui, a explicação mais sólida continua vindo do schema e do código compilado, não da documentação de superfície.

### 10. A hipótese já foi confirmada em um segundo sensor em execução

Depois da inspeção estática, fizemos uma validação funcional mínima com o comando:

```bash
pi --provider github-copilot --model gpt-5.4 -p "/work-quality"
```

Resultado observado:

```text
[work-quality] classify failed: No tool call in response (stopReason: error, content: [] error: Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted)
```

Esse resultado importa porque fecha o ciclo de evidência em dois níveis:

1. inspeção estática: todos os classificadores empacotados usam `model: claude-sonnet-4-6` sem provider
2. validação funcional: outro sensor além do `hedge` falha do mesmo modo em ambiente autenticado apenas com `github-copilot`

Com isso, a leitura mais forte sobe de patamar:

- não estamos diante de um problema local do `hedge`
- já existe confirmação prática de que a fragilidade alcança pelo menos um segundo sensor (`work-quality`)
- a questão relevante do laboratório deixa de ser apenas "como corrigir o hedge" e passa a ser "como o ecossistema Pi deveria alinhar sensores auxiliares ao provider principal"

### 11. O mesmo padrão apareceu em um sensor orientado a tool use

Para sair do eixo `turn_end` e `command`, fizemos uma reprodução mínima com tool use explícito:

```bash
pi --provider github-copilot --model gpt-5.4 -p "Use uma ferramenta para listar os arquivos do diretório atual e depois pare."
```

O agente executou a ação pedida e respondeu com a listagem do diretório, mas ao final surgiu o erro auxiliar:

```text
[fragility] classify failed: No tool call in response (stopReason: error, content: [] error: Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted)
```

Esse resultado é importante por três motivos:

1. confirma o mesmo padrão em um sensor ligado ao fluxo de tool use
2. mostra que a fragilidade atravessa tipos diferentes de evento (`turn_end`, `command`, `message_end`)
3. reduz ainda mais a chance de estarmos diante de um bug isolado de um único monitor

Com isso, o quadro experimental atual fica assim:

- `hedge`: falha reproduzida e neutralizada com override local
- `work-quality`: falha reproduzida em comando dedicado
- `fragility`: falha reproduzida após tool use legítimo

O problema, neste ponto, já merece ser tratado como comportamento sistêmico da família de classificadores empacotados até prova em contrário.

### 12. Não encontramos issue pública correspondente no upstream

Depois de identificar o repositório upstream declarado no `package.json` do pacote:

- `davidorex/pi-project-workflows`

fizemos buscas por issues com combinações como:

- `"Could not resolve authentication method"`
- `"claude-sonnet-4-6"`
- `classify.agent provider`
- `monitor provider`

restritas ao próprio repositório.

Resultado observado:

- nenhuma issue encontrada para esses termos no upstream consultado

Isso não prova ausência definitiva de conhecimento prévio, mas fortalece duas leituras úteis para o laboratório:

1. a descoberta parece pouco documentada publicamente até aqui
2. o experimento local deixa de ser apenas reprodução de conhecimento conhecido e passa a ter valor como achado original de integração

Atualização posterior:

- issue upstream aberta em `davidorex/pi-project-workflows`: issue `#1`
- foco da issue: default implícito para Anthropic em classifier agents com model spec sem provider

### 13. O laboratório adotou uma correção local explícita

Neste estágio, não há impedimento técnico relevante para corrigir localmente e seguir investigando. O laboratório passou a tratar isso como patch consciente de workspace, não como ajuste escondido.

Overrides locais padronizados em `.pi/agents/`:

- `commit-hygiene-classifier.agent.yaml`
- `fragility-classifier.agent.yaml`
- `hedge-classifier.agent.yaml`
- `unauthorized-action-classifier.agent.yaml`
- `work-quality-classifier.agent.yaml`

Todos agora apontam para:

```yaml
model: github-copilot/claude-sonnet-4.6
```

Com isso, a regra prática adotada pelo laboratório passa a ser:

1. corrigir localmente quando o comportamento impedir experimentação limpa
2. documentar claramente que a correção é uma camada de adaptação do workspace
3. preservar a possibilidade de isolar essa adaptação mais tarde, quando ela puder virar primitiva, convenção ou pacote próprio

### 14. A correção local também separou configuração de saída operacional

Depois dos overrides, surgiu um artefato em `.project/issues.json` produzido pelos monitores.

Leitura atual do laboratório:

- `.pi/agents/` é configuração intencional e versionável
- `.project/` é saída operacional de runtime e não deve ser confundida com configuração do projeto

Por isso, nesta fase, `.project/` foi tratado como artefato ignorado do workspace, mas mantido como pista arquitetural relevante para futuras primitivas de monitoramento e triagem.

## O que este experimento ainda não conclui

Ainda não concluímos:

- se o pacote espera alguma configuração adicional do usuário
- se há fallback automático de provider e ele está escolhendo um backend incompatível
- se o comportamento é bug, limitação conhecida ou trade-off deliberado do pacote
- se essa solução deve ser tratada como workaround local ou convenção legítima do laboratório
- se a discrepância entre skill/README e runtime é atraso de documentação ou mudança de arquitetura ainda não consolidada
- se o alinhamento local de todos os classificadores deve permanecer no laboratório até existir solução upstream
- se devemos abrir issue upstream com repro mínima e hipótese causal já documentada

## Implicações para o laboratório

Este caso é valioso por três razões:

1. mostra como um pacote pode embutir uma filosofia de correção comportamental
2. mostra como essa filosofia se materializa no workspace
3. mostra como um erro auxiliar pode revelar um desacoplamento imperfeito entre runtime principal e sensores secundários

O aprendizado central aqui não é “desabilitar hedge”.

É reconhecer que o laboratório precisa aprender a ler monitores, sensores e artefatos auxiliares como parte do design do ecossistema.

Também é o primeiro caso claro em que um arquivo dentro de `.pi/` deixa de ser apenas artefato ambíguo e passa a funcionar como configuração intencional de projeto.

## Próximos passos

1. acompanhar a issue upstream `davidorex/pi-project-workflows#1` e ajustar a adaptação local quando houver resposta ou correção
2. decidir se o alinhamento local dos classificadores deve virar convenção temporária do laboratório até nova evidência
3. usar o caso como referência para futuras decisões sobre `.pi/` e `.project/` como superfícies distintas de projeto e runtime
