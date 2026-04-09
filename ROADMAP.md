# Roadmap — agents-lab

Planejamento e milestones do laboratório. Este é um documento vivo — evolui conforme o laboratório cresce.

## Fase 0 — Fundação (atual)

**Objetivo:** Criar o solo que vai receber o brainstorm e as pesquisas futuras.

- [x] Estrutura inicial do repositório
- [x] README com missão, visão e filosofia
- [x] Estrutura de diretórios (`docs/`, `experiments/`, `primitives/`)
- [x] Documentação de convenções e contribuição
- [ ] Definir estrutura de longo prazo do repositório (monorepo ou não?)
  - *Pesquisa pendente: avaliar estado da arte em baixa fricção cognitiva para este tipo de projeto*

## Fase 1 — Pesquisa e Documentação

**Objetivo:** Organizar o material existente e construir base de conhecimento.

- [ ] Análise aprofundada do ecossistema Pi
  - [ ] Mapeamento de todos os pacotes e suas responsabilidades
  - [ ] Identificação dos padrões de design usados
  - [ ] Análise de casos de uso (openclaw e outros)
- [ ] Catalogar material de referência externo
  - [ ] [tuts-agentic-ai-examples](https://github.com/nilayparikh/tuts-agentic-ai-examples) — padrões de AI Agents
  - [ ] Protocolo A2A (Agent-to-Agent)
- [ ] Pesquisa sobre estrutura de baixa fricção cognitiva
  - [ ] Avaliação de monorepo vs. repositórios independentes
  - [ ] Análise de projetos similares na comunidade
- [ ] Análise de engines alternativas ao Pi (LangChain, AutoGen, CrewAI, etc.)

## Fase 2 — Primeiros Experimentos

**Objetivo:** Rodar experimentos concretos e começar a identificar primitivas.

- [ ] Primeiro experimento com `pi-agent-core`
- [ ] Experimento com tool calling em Pi
- [ ] Experimento com múltiplos providers de LLM
- [ ] Experimento com A2A protocol
- [ ] Identificar padrões recorrentes candidatos a primitivas

## Fase 3 — Primeiras Primitivas

**Objetivo:** Formalizar as primeiras primitivas reutilizáveis.

- [ ] Definir estrutura padrão de pacote de primitiva
- [ ] Implementar e documentar primeira primitiva de memória
- [ ] Implementar e documentar primeira primitiva de ferramentas
- [ ] Avaliar estratégia de publicação (npm, etc.)

## Fase 4 — Comunidade e Escala

**Objetivo:** Abrir o laboratório para contribuições externas e escalar o ecossistema.

- [ ] Decidir estrutura de longo prazo (monorepo, múltiplos repos, etc.)
- [ ] Publicar primeiras primitivas no registro npm (se aplicável)
- [ ] Guia de onboarding para novos colaboradores
- [ ] Processo de avaliação e promoção de primitivas

---

## Decisões Pendentes

| Decisão | Contexto | Prazo |
|---------|----------|-------|
| Monorepo ou não? | Avaliar estado da arte antes de decidir — alta dependência da estrutura de longo prazo | Fase 1 |
| Linguagem principal | TypeScript (Pi) vs. Python vs. poliglota | Fase 2 |
| Estratégia de publicação | npm / PyPI / GitHub Packages | Fase 3 |

## Notas

- O roadmap é orientativo, não prescritivo. A natureza experimental do laboratório exige flexibilidade.
- Novas descobertas nas fases iniciais podem reordenar ou reescrever fases futuras.
- Cada milestone deve ser discutido antes de ser iniciado.
