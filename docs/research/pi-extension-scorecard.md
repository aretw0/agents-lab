---
created: 2026-04-09
status: draft
---

# Scorecard de Extensões e Referências Pi

## Contexto

O diretório de pacotes do Pi já é grande o suficiente para gerar paralisia por escolha. Este scorecard existe para transformar descoberta em decisão.

O foco aqui não é catalogar tudo. É identificar quais referências realmente ajudam o agents-lab a chegar ao handoff futuro para Pi com o menor atrito possível.

## Metodologia

Os projetos foram avaliados com base em:

1. alinhamento com nossos workflows atuais
2. capacidade de bootstrap rápido
3. clareza arquitetural
4. reutilização como base para extensões in-house
5. presença de mecanismos de teste, validação ou observabilidade

Escala usada:

- **★★★★★** — referência prioritária
- **★★★★☆** — muito útil, mas não é o eixo principal
- **★★★☆☆** — útil em cenários específicos

## Referências-Chave

### 1. oh-pi

**Repositório:** [ifiokjr/oh-pi](https://github.com/ifiokjr/oh-pi)

| Critério | Avaliação |
|----------|-----------|
| Bootstrap rápido | Excelente |
| Cobertura de workflows | Alta |
| Qualidade de composição | Alta |
| Relevância para in-house | Alta |
| Nota final | ★★★★★ |

**Pontos fortes**

- instala um bundle coerente com um único comando
- cobre extensões, skills, prompts e themes
- inclui recursos operacionais muito úteis como `git-guard`, `custom-footer`, `auto-session-name`
- traz uma proposta forte de multi-agente com `ant-colony`
- possui workflow `/spec`, o que toca diretamente planejamento e execução

**Pontos de atenção**

- pacote opinativo e abrangente, com chance real de instalar mais do que precisamos
- parte da composição pode se sobrepor com escolhas futuras nossas

**Leitura para o laboratório**

É a melhor base para bootstrap. Mesmo que no futuro façamos cherry-pick, ele funciona como baseline de referência do que uma distribuição Pi coesa pode ser.

### 2. pi-project-workflows

**Repositório:** [davidorex/pi-project-workflows](https://github.com/davidorex/pi-project-workflows)

| Critério | Avaliação |
|----------|-----------|
| Bootstrap rápido | Médio |
| Cobertura de workflows | Alta |
| Clareza arquitetural | Excelente |
| Relevância para in-house | Excelente |
| Nota final | ★★★★★ |

**Pontos fortes**

- filosofia extremamente alinhada com o laboratório: o uso molda a ferramenta
- project state orientado por schema, o que reduz necessidade de alterar TypeScript para cada nova estrutura
- workflows DAG com tipagem e checkpoint/resume
- behavior monitors como camada de steering e verificação

**Pontos de atenção**

- é mais framework de operação sobre Pi do que bundle de adoção imediata
- exige disciplina de modelagem para extrair valor máximo

**Leitura para o laboratório**

É a melhor referência conceitual para nossa futura fábrica. Mesmo se não adotarmos o stack inteiro, a filosofia e a estrutura são material de primeira linha.

### 3. espennilsen/pi

**Repositório:** [espennilsen/pi](https://github.com/espennilsen/pi)

| Critério | Avaliação |
|----------|-----------|
| Bootstrap rápido | Médio |
| Cobertura de workflows | Alta |
| Clareza arquitetural | Boa |
| Relevância para in-house | Alta |
| Nota final | ★★★★☆ |

**Pontos fortes**

- mostra um `~/.pi/agent` real tratado como produto pessoal
- cobre integrações práticas: GitHub, cron, jobs, memory, subagent, web dashboard, project switching
- bom exemplo de ecossistema incremental e pragmático

**Pontos de atenção**

- desenho bastante personalizado para o workflow do autor
- menos adequado como base universal do que `oh-pi`

**Leitura para o laboratório**

É a melhor referência de "Pi home directory versionado". Como decidimos que este repositório não será nosso `~/.pi/agent`, ele vira mais um repertório de padrões do que um template direto.

### 4. pi-test-harness

**Repositório:** [marcfargas/pi-test-harness](https://github.com/marcfargas/pi-test-harness)

| Critério | Avaliação |
|----------|-----------|
| Bootstrap rápido | Alto |
| Cobertura de workflows | Média |
| Qualidade para desenvolvimento | Excelente |
| Relevância para in-house | Excelente |
| Nota final | ★★★★★ |

**Pontos fortes**

- resolve o maior problema de extensões Pi: testar sem LLM real
- mantém o runtime do Pi real e substitui apenas as fronteiras necessárias
- oferece mock de tools, UI e até do binário `pi`
- inclui verificação de instalação em sandbox, ótima para publicação npm

**Pontos de atenção**

- não resolve curadoria nem composição; resolve qualidade e desenvolvimento

**Leitura para o laboratório**

É peça obrigatória para qualquer ambição séria de extensões in-house.

### 5. pi-lens

**Repositório:** [apmantza/pi-lens](https://github.com/apmantza/pi-lens)

| Critério | Avaliação |
|----------|-----------|
| Bootstrap rápido | Alto |
| Cobertura de workflows | Alta (qualidade de código) |
| Qualidade arquitetural | Excelente |
| Relevância para in-house | Alta |
| Nota final | ★★★★★ |

**Pontos fortes**

- feedback de código inline e em tempo real, integrado ao ciclo de vida do Pi
- pipeline multi-camada: formatação, type-checking, lint, testes, segurança, análise estrutural (tree-sitter + ast-grep)
- auto-instala dependências baseado no contexto do projeto (config-gated, flow-gated)
- suporte a 31+ language servers via LSP unificado
- comandos úteis: `/lens-booboo` (relatório de qualidade) e `/lens-health` (telemetria)
- desenvolvimento muito ativo (v3.8.22, 4 releases, 4 contribuidores)
- delta reporting: prioriza issues novas sobre ruído legacy

**Pontos de atenção**

- instala muitas dependências automaticamente (Biome, Ruff, ast-grep, knip, jscpd, madge...)
- pode conflitar com linters/formatters já configurados no projeto
- projeto relativamente novo (18 stars), mas evolução rápida

**Leitura para o laboratório**

É o melhor candidato para garantir qualidade de código durante sessões de agente. Funciona como "segundo par de olhos" automático. Complementa `pi-test-harness` (que testa extensões) com feedback contínuo na escrita.

## Extensões e Pacotes de Destaque

| Pacote | Capability principal | Leitura inicial |
|--------|----------------------|-----------------|
| `@ifi/pi-plan` | planejamento persistente e branch-aware | candidato forte para planejamento |
| `@ifi/pi-extension-subagents` | subagentes com mais recurso | candidato forte para delegação |
| `pi-subagents` | subagentes e paralelismo | referência base da categoria |
| `@0xkobold/pi-orchestration` | chain, parallel, fork execution | promissor para composição avançada |
| `pi-web-access` | web search/fetch/research | alta utilidade operacional |
| `@touchskyer/memex` | memória estilo zettelkasten | bom candidato para estudos de memória |
| `pi-continuous-learning` | aprendizado a partir de sessões | valioso para melhoria contínua |
| `@artale/pi-eval` | avaliação de sessões | relevante para medir qualidade |
| `@artale/pi-evolve` | evolução de prompts/skills | interessante, mas ainda experimental |
| `pi-conversation-retro` | postmortem de sessões | útil para loops de melhoria |
| `@counterposition/skill-pi` | skill sobre o próprio Pi | boa referência de orientação |
| `@tmustier/extending-pi` | guia de extensibilidade | leitura obrigatória para factory |

## Recomendação Atual

### Prioridade 1

- `oh-pi`
- `pi-project-workflows`
- `pi-test-harness`
- `pi-lens`

### Prioridade 2

- `pi-web-access`
- `@ifi/pi-plan`
- `@ifi/pi-extension-subagents`
- `@0xkobold/pi-orchestration`

### Prioridade 3

- memória, avaliação e auto-melhoria

Essa ordem reflete a necessidade do laboratório hoje:

1. conseguir adotar Pi com pouca fricção
2. ter estrutura para workflows mais sofisticados
3. preparar a futura construção de extensões próprias com qualidade

## Conclusões

- `oh-pi` é a melhor base de bootstrap.
- `pi-project-workflows` é a melhor referência filosófica e arquitetural.
- `pi-test-harness` é a peça crítica da futura fábrica de extensões.
- A categoria mais ambígua hoje é multi-agente, onde há overlap demais e pouca decisão consolidada.

## Referências

- [ifiokjr/oh-pi](https://github.com/ifiokjr/oh-pi)
- [davidorex/pi-project-workflows](https://github.com/davidorex/pi-project-workflows)
- [espennilsen/pi](https://github.com/espennilsen/pi)
- [marcfargas/pi-test-harness](https://github.com/marcfargas/pi-test-harness)
- [apmantza/pi-lens](https://github.com/apmantza/pi-lens)
- [pi.dev/packages](https://pi.dev/packages)
