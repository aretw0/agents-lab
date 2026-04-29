# Checklist: presença do repositório no GitHub

Objetivo: manter a apresentação pública do `agents-lab` coerente com o posicionamento real do projeto: laboratório local-first, stack pi simple-first e primitivas reutilizáveis de agentes sem acoplamento a um único outcome.

## Posicionamento público

Descrição curta sugerida para o repositório:

> Laboratório local-first para construir, calibrar e distribuir primitivas reutilizáveis de agentes de IA, incluindo a stack curada `@aretw0/pi-stack` para pi.

Topics/tags sugeridos:

```text
ai-agents
pi
coding-agent
agent-tools
local-first
developer-tools
typescript
llm
automation
```

Framing consistente em README/docs:

- **simple-first**: instalação e uso inicial devem parecer simples; capacidades avançadas entram por opt-in;
- **outcome-agnostic**: o projeto suporta desde prompts manuais até control-plane/long-run, sem vender um único modo como obrigatório;
- **local-first**: calibração, gates e evidência começam na máquina local antes de promoção para CI/GitHub Actions;
- **portable primitives**: melhorias devem ser descritas como primitivas/adapters reutilizáveis, não como hacks exclusivos do laboratório.

## Checklist operacional

Executar em revisão periódica leve (ex.: mensal, antes de release ou quando mudar o posicionamento público):

1. **README raiz**
   - missão e descrição curta ainda refletem o estado atual;
   - instalação rápida usa o caminho recomendado atual;
   - pacotes listados ainda correspondem ao perfil distribuído;
   - links para guias principais funcionam.

2. **Guias canônicos**
   - `docs/guides/README.md` lista guias novos e remove entradas obsoletas;
   - `docs/guides/lab-user-surface-parity.md` continua alinhado ao default de instalação;
   - `docs/guides/project-canonical-pipeline.md` descreve contratos operacionais atuais sem drift.

3. **Drift de documentação / MDT**
   - procurar termos antigos de posicionamento que conflitem com `simple-first`, `local-first` ou `outcome-agnostic`;
   - se existir `mdt` ou ferramenta equivalente, rodar somente em arquivos alterados ou escopo pequeno;
   - ignorar code fences, comandos, paths, IDs, logs e nomes de API;
   - registrar findings no board quando houver alteração material.

4. **Metadados do GitHub**
   - comparar descrição e topics atuais do repositório com a seção “Posicionamento público” deste guia;
   - alterar metadados públicos apenas com intenção explícita do operador, pois é mutação remota;
   - registrar antes/depois em `verification` quando houver mudança remota.

5. **Distribuição e release**
   - confirmar que README não promete capacidades fora do perfil `strict-curated` sem marcar como opt-in;
   - manter recursos avançados (`curated-runtime`, swarm/colony, web remote) como progressive disclosure;
   - evitar que docs internas de laboratório virem promessa pública sem checklist de aceitação.

## Evidência mínima para o board

Ao fechar uma revisão de presença pública, registrar:

- arquivos inspecionados/alterados;
- descrição/topics alvo ou efetivamente aplicados;
- comando/check usado para links ou drift, quando houver;
- se houve ou não mutação remota no GitHub;
- rationale quando a revisão tocar README, docs públicas ou testes existentes.

## Não objetivos

- Não editar `.github/workflows` durante a revisão de presença pública, salvo task explícita de CI.
- Não fazer publish ou release.
- Não alterar metadados remotos via `gh repo edit` sem confirmação humana.
- Não rodar varreduras amplas em `node_modules`, sessões ou diretórios gerados.
