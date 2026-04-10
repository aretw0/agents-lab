# Mapa do Ecossistema Pi

## Contexto

Pi é a engine principal do laboratório, mas a utilidade real do ecossistema não está apenas no core. O valor está na combinação entre runtime, modelo de extensibilidade, diretório de pacotes e padrões emergentes da comunidade.

Este documento serve como mapa-base para orientar decisões futuras de curadoria, adoção e eventual substituição de componentes por alternativas in-house.

## Visão Geral

O ecossistema Pi pode ser lido em cinco camadas:

1. **Runtime e SDK** — os pacotes centrais do pi-mono
2. **Agent UX** — TUI, CLI e superfícies interativas
3. **Extensibilidade** — extensões, skills, prompts, themes e providers
4. **Distribuição** — npm + instalação via `pi install`
5. **Composições da comunidade** — bundles, home directories, orquestradores e kits opinativos

## Pacotes Centrais do pi-mono

| Pacote | Papel | Observações |
|--------|-------|-------------|
| `@mariozechner/pi-ai` | API unificada para LLM providers | Abstrai providers e modelos, reduz lock-in de API |
| `@mariozechner/pi-agent-core` | Runtime de agentes | Tool calling, streaming, estado e ciclo de vida |
| `@mariozechner/pi-coding-agent` | CLI interativo | Superfície principal de uso para coding agent |
| `@mariozechner/pi-tui` | Terminal UI | Base visual do agente em terminal |
| `@mariozechner/pi-web-ui` | Componentes web | Útil para experiências fora do terminal |

## Modelo de Extensibilidade

Pi não é apenas um agente. Ele é uma plataforma de composição. Os principais artefatos extensíveis são:

### Extensions

São módulos com código que podem:

- registrar ferramentas novas
- interceptar chamadas de ferramentas existentes
- reagir a eventos do ciclo de vida da sessão
- adicionar comandos, overlays, widgets e integrações
- persistir estado e expor fluxos próprios

Em termos práticos, extensões são o lugar onde o comportamento operacional vive.

### Skills

São pacotes de instruções reutilizáveis, normalmente em `SKILL.md`, que ensinam o agente a executar um tipo de tarefa ou workflow com mais consistência. Skills tendem a concentrar comportamento declarativo, playbooks e heurísticas.

### Prompt Templates

São atalhos opinativos para tarefas recorrentes como review, refactor, test e document. Funcionam como contratos de intenção.

### Themes

Alteram a apresentação visual da TUI. Têm utilidade menor para este laboratório, mas fazem parte da ergonomia da adoção.

### Providers

Integram novos backends de modelos. Isso inclui tanto providers oficiais quanto bridges experimentais para Cursor, Ollama, Claude Code e outros.

## Ciclo de Vida Relevante para Extensões

Os padrões observados nos repositórios analisados mostram um uso recorrente destes pontos de integração:

1. `session_start` — bootstrap de estado, leitura de configuração, warm-up
2. `tool_call` — bloqueio, rewrite, confirmação, roteamento ou auditoria
3. `tool_result` — coleta de telemetria, atualização de dashboards, heurísticas
4. `turn_end` — resumo, aprendizado, auto-nomeação de sessão
5. `agent_end` — fechamento de ciclo, classificação, notificações
6. `session_shutdown` — limpeza, flush de estado, persistência final

Na prática, a maioria das extensões úteis da comunidade se organiza em torno de três capacidades:

- **instrumentar** o agente
- **dirigir** o agente
- **compor** múltiplos agentes

## Como os Pacotes São Distribuídos

O modelo padrão é:

1. publicar em npm
2. instalar com `pi install npm:<pacote>`
3. configurar via `settings.json` global ou local ao projeto

Isso cria duas propriedades importantes:

- distribuição simples e alinhada ao ecossistema Node
- baixo atrito para experimentar e remover pacotes

## Diretório de Pacotes

O diretório em [pi.dev/packages](https://pi.dev/packages) mostra um ecossistema já grande e altamente redundante. Em abril de 2026, o catálogo ultrapassa 1100 pacotes entre extensões, skills, prompts e themes.

Esse volume tem duas implicações:

1. há muita composição pronta para reaproveitar
2. há muito overlap, duplicação e opinião concorrente

Para o laboratório, isso reforça a necessidade de **curadoria**, não apenas descoberta.

## Padrões Emergentes da Comunidade

Os repositórios avaliados apontam alguns clusters bem definidos:

### 1. Bootstrap Bundles

Exemplo principal: `oh-pi`

Objetivo: oferecer uma instalação única com tema, extensões, prompts e skills já combinados.

### 2. Home Directory Versionado

Exemplo principal: `espennilsen/pi`

Objetivo: tratar `~/.pi/agent` como um repositório versionado e componível.

### 3. Workflow Engines sobre Pi

Exemplo principal: `pi-project-workflows`

Objetivo: fazer Pi operar como runtime de workflows tipados, project state e monitores de comportamento.

### 4. Orquestração Multi-agente

Exemplos: `ant-colony`, `pi-subagents`, `pi-orchestration`, `pi-teams`

Objetivo: decompor trabalho em unidades paralelas, isoladas ou especializadas.

### 5. Memória e Aprendizado

Exemplos: `pi-memory`, `pi-brain`, `memex`, `pi-continuous-learning`

Objetivo: preservar contexto, fatos, padrões e lições além da janela da conversa atual.

### 6. Segurança e Governança

Exemplos: `safe-guard`, `git-guard`, `pi-gate`, `pi-preflight`, `pi-sandbox`

Objetivo: reduzir risco operacional sem precisar mudar o core.

### 7. Teste e Qualidade

Exemplo principal: `pi-test-harness`

Objetivo: testar extensões em ambiente realista sem depender de LLM real.

### 8. Feedback de Código em Tempo Real

Exemplo principal: `pi-lens`

Objetivo: rodar lint, type-check, formatação, testes e análise estrutural (tree-sitter + ast-grep) em tempo real durante sessões do agente. Auto-instala dependências por contexto do projeto. Inclui delta reporting para priorizar issues novas.

## Oportunidade para o agents-lab

O laboratório não precisa construir tudo do zero. O caminho mais racional é:

1. usar Pi como runtime principal
2. curar o melhor da comunidade por capability
3. observar overlaps e fricções reais
4. substituir gradualmente peças críticas por extensões in-house menores e mais precisas

## Conclusões

- Pi já é um ecossistema, não apenas uma engine isolada.
- O problema principal agora não é falta de capacidade, e sim seleção e composição.
- A futura fábrica de extensões deve nascer orientada por gaps concretos encontrados na curadoria, não por reimplementação precoce.
- Para integração com GitHub no curto prazo, o laboratório ainda não encontrou uma superfície operacional pronta no ecossistema instalado equivalente ao que `gh` CLI já oferece. Isso reforça uma estratégia de composição pragmática: Pi para inferência e tool calling, `gh` para operações GitHub.

## Referências

- [pi.dev/packages](https://pi.dev/packages)
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- [ifiokjr/oh-pi](https://github.com/ifiokjr/oh-pi)
- [davidorex/pi-project-workflows](https://github.com/davidorex/pi-project-workflows)
- [espennilsen/pi](https://github.com/espennilsen/pi)
- [marcfargas/pi-test-harness](https://github.com/marcfargas/pi-test-harness)
- [apmantza/pi-lens](https://github.com/apmantza/pi-lens)
