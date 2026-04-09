---
created: 2026-04-09
status: draft
---

# Blueprint da Fábrica de Extensões Pi

## Contexto

Se o laboratório quiser migrar parte do valor da comunidade para extensões in-house menores, polidas e mais concisas, precisamos entender a cadeia completa: autoria, teste, empacotamento, publicação e manutenção.

## Metodologia

Este blueprint consolida padrões observados em:

- `oh-pi` como monorepo de distribuição
- `pi-project-workflows` como arquitetura composta e orientada por schema
- `pi-test-harness` como infraestrutura de teste
- guias e pacotes do ecossistema dedicados à extensibilidade

## Componentes da Fábrica

### 1. Template de Extensão

Uma extensão Pi precisa, no mínimo:

- `package.json` com metadados corretos para instalação via npm
- arquivo de entrada em TypeScript ou JavaScript
- uso de `defineExtension()` ou padrão equivalente do SDK Pi
- build para formato compatível com carregamento do Pi

Padrão desejado para o laboratório:

1. package isolado por capability
2. superfície pequena e intencional
3. configuração mínima e explícita

### 2. Template de Skill

Skills são muito mais leves que extensões e devem ser o primeiro nível de customização quando o problema for comportamental, não operacional.

Estrutura típica:

- pasta própria
- `SKILL.md`
- eventualmente exemplos ou material de apoio

Heurística útil:

- se o problema é instrução recorrente, comece com skill
- se o problema exige hooks, tools, UI ou persistência, vá de extensão

### 3. Estrutura de Monorepo

Os dois melhores referenciais aqui são:

- `oh-pi` para um monorepo amplo de distribuição
- `pi-project-workflows` para um conjunto coeso de pacotes integrados

Uma estrutura mínima plausível para nossas futuras extensões seria:

```text
packages/
  docs-lab-skill/
  handoff-memory/
  research-compactor/
test-utils/
scripts/
```

Mas isso só faz sentido quando houver ao menos duas ou três peças justificando shared tooling.

### 4. Testing

`@marcfargas/pi-test-harness` é a peça central.

Ele permite:

- rodar a extensão em ambiente Pi real
- mockar tools sem quebrar hooks
- mockar UI
- mockar subprocessos que invocam `pi`
- verificar se o pacote empacota e instala corretamente

Decisão arquitetural implícita:

Toda extensão in-house deve nascer com teste de sessão e verificação de instalação.

### 5. Publicação

Fluxo esperado:

1. versionamento
2. build
3. testes
4. `npm publish`
5. instalação via `pi install npm:<scope>/<pkg>`

Isso sugere desde cedo:

- usar scope consistente
- manter nomes de pacote alinhados por capability
- evitar acoplamento oculto entre pacotes

### 6. Documentação

Cada extensão ou skill futura deve responder rapidamente:

- o que resolve
- por que existe se já há algo parecido na comunidade
- como testar
- como instalar
- como remover

## Critérios para Criar Algo In-House

Só devemos criar uma peça própria quando pelo menos um destes critérios for verdadeiro:

1. há overlap excessivo e queremos uma versão menor e mais precisa
2. há lacuna clara não coberta por pacotes existentes
3. a composição externa tem atrito de manutenção alto demais
4. precisamos de integração profunda com os artefatos do laboratório

## Sequência Recomendada de Maturidade

1. curadoria de pacotes existentes
2. prompts e skills próprias
3. primeira extensão pequena e específica
4. suíte de testes padronizada
5. eventual monorepo separado de extensões

## O Que Não Fazer Agora

- abrir monorepo de extensões sem backlog real de pacotes
- definir fábrica completa antes de validar Pi em uso
- reimplementar capabilities que ainda não testamos no ecossistema

## Conclusões

- A fábrica de extensões deve nascer enxuta e guiada por gaps reais.
- `pi-test-harness` é o alicerce técnico mais importante dessa futura fase.
- A primeira entrega in-house mais provável não é uma grande extensão, e sim uma combinação de skill, prompts e um pacote pequeno de integração documental.

## Referências

- [marcfargas/pi-test-harness](https://github.com/marcfargas/pi-test-harness)
- [ifiokjr/oh-pi](https://github.com/ifiokjr/oh-pi)
- [davidorex/pi-project-workflows](https://github.com/davidorex/pi-project-workflows)
- [pi.dev/packages](https://pi.dev/packages)
