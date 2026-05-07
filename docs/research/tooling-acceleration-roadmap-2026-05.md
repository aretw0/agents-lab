# Roadmap de aceleração de ferramentas para agentes — 2026-05

## Objetivo

Tornar a pi-stack pronta para usar ferramentas rápidas quando elas ajudam, sem substituir Node/Python quando o caminho direto for mais correto. A adoção deve ser local-first, report-only antes de qualquer instalação, e sempre reversível.

## Política operacional

- Ferramentas rápidas são aceleradores opcionais, não defaults universais.
- Agentes devem preferir a ferramenta nativa do projeto quando houver lockfile, scripts ou convenções claras.
- Instalação/bootstrap global ou alteração de ambiente exige confirmação explícita do operador.
- Canaries devem ser pequenos, locais e com rollback conhecido.
- Em disco apertado, só é permitido detectar/reportar; builds amplos e installs ficam bloqueados.

## Candidatas iniciais

| Ferramenta | Acelera | Usar quando | Evitar quando |
|---|---|---|---|
| `bun` | tarefas JS/TS, scripts curtos, testes compatíveis | projeto já suporta Bun, canary mostra ganho, ou script é isolado | monorepo depende de semântica `node`/`pnpm`, plugins incompatíveis, lockfile exige outro gerenciador |
| `uv` | ambientes e tooling Python | projeto Python aceita `uv`, criação de venv/cache é local e reversível | ambiente Python já está fixado por `pip`, `poetry`, `conda` ou política do projeto |
| `ripgrep`/`fd` | descoberta read-only | busca textual/arquivos sem mutação | scans amplos em áreas protegidas ou diretórios de sessão |
| `tsx`/`esbuild` | scripts TS pequenos | execução local curta sem build completo | caminho de build oficial precisa ser preservado |

## Fases de adoção

### Fase 0 — inventário report-only

- Detectar presença e versão com comandos read-only e bounded.
- Registrar disponibilidade sem alterar PATH, settings globais ou lockfiles.
- Produzir recomendação `use-if-available`, `needs-canary`, ou `do-not-use-here`.

### Fase 1 — canary local

- Rodar um caso pequeno que já tenha validação equivalente em ferramenta oficial.
- Comparar tempo, saída e compatibilidade.
- Falhar fechado se a ferramenta gerar artefatos inesperados, baixar dependências fora do cache esperado ou divergir da saída oficial.

### Fase 2 — wrapper opt-in

- Expor primitiva/prompt que escolha a ferramenta rápida apenas quando os gates estão verdes.
- Manter fallback explícito para Node/Python direto.
- Documentar rollback: apagar cache local/artefatos criados e voltar ao comando oficial.

### Fase 3 — adoção em pacote

- Só depois de canaries repetíveis.
- Não instalar globalmente sem confirmação.
- Publicar orientação de uso para agentes e operadores, com exemplos de quando não usar.

## Critérios de decisão

- Velocidade: ganho real em fatia focal, não benchmark genérico.
- Compatibilidade: respeita lockfiles, scripts e runtime do projeto.
- Segurança: não executa install remoto/desconhecido sem opt-in.
- Offline/cache: funciona com dependências já disponíveis ou cache controlado.
- Manutenção: reduz complexidade operacional em vez de criar bifurcação de tooling.
- Custo cognitivo: agente consegue explicar por que escolheu a ferramenta.

## Pacote inicial: Bun (`TASK-BUD-993`)

### Detecção read-only local

- `bun`: não encontrado no PATH deste ambiente.
- `node`: disponível (`v24.6.0`).
- `pnpm`: disponível (`10.33.0`).

### Decisão atual

`bun` fica em estado `needs-opt-in-install`. A pi-stack pode orientar agentes a usá-lo quando já estiver presente, mas não deve instalar nem trocar comandos oficiais automaticamente.

### Quando Bun pode acelerar

- Scripts JS/TS isolados sem dependência de semântica específica do `pnpm`.
- Testes pequenos em projetos que já declaram suporte a Bun.
- Canaries onde a saída é comparada com o comando oficial do projeto.

### Quando manter Node/pnpm

- Monorepos com `pnpm-workspace.yaml` e scripts já validados via `pnpm`.
- Testes Vitest/TS que dependem da configuração atual do projeto.
- Qualquer tarefa em que instalar Bun aumentaria risco de disco, cache ou PATH global.

### Bootstrap opt-in proposto

1. Detectar `bun --version` sem instalar.
2. Se ausente, emitir pacote report-only com instruções e rollback; não executar install.
3. Se presente, rodar canary pequeno comparando comando Bun com comando oficial.
4. Só documentar `use-if-available` após canary passar.

## Pacote inicial: uv (`TASK-BUD-994`)

### Detecção read-only local

- `uv`: disponível em `/c/users/aretw/.local/bin/uv` (`uv 0.8.22`).
- `python`/`python3`/`py`: não encontrados pelo shell atual.

### Decisão atual

`uv` fica em estado `use-if-project-python-context-exists`. Ele está disponível para agentes, mas não deve criar ambiente, baixar dependências ou substituir fluxo Python do projeto sem um canary explícito.

### Quando uv pode acelerar

- Criação/uso de ambiente Python local quando o projeto já tem contexto Python claro.
- Execução de ferramentas Python isoladas com cache conhecido e rollback simples.
- Canaries onde `uv` reproduz o comportamento esperado do comando Python oficial.

### Quando evitar uv

- Repositórios sem tarefa Python ativa.
- Ambientes que dependem de `conda`, `poetry`, `pipenv` ou Python gerenciado externamente.
- Situações de disco apertado em que criar cache/venv novo pode piorar pressão local.

### Bootstrap opt-in proposto

1. Detectar `uv --version` e presença de arquivos Python (`pyproject.toml`, `requirements*.txt`, scripts relevantes).
2. Se não houver contexto Python, manter `uv` apenas como disponível.
3. Se houver contexto, propor canary pequeno com cache/venv local e rollback explícito.
4. Só recomendar `uv` após comparar com o comando oficial do projeto.

## Próximas tarefas

- Cultivar wrappers report-only para detecção de tooling quando houver repetição suficiente.

## Rollback padrão

1. Parar no primeiro sinal de incompatibilidade.
2. Usar o comando oficial do projeto como fonte de verdade.
3. Remover artefatos locais criados pelo canary, quando houver.
4. Registrar no board que a ferramenta permanece `needs-canary` ou `do-not-use-here`.
