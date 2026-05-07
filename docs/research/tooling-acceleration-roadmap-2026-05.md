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

## Próximas tarefas

- `TASK-BUD-993`: avaliar suporte opcional a Bun.
- `TASK-BUD-994`: avaliar suporte opcional a uv.

## Rollback padrão

1. Parar no primeiro sinal de incompatibilidade.
2. Usar o comando oficial do projeto como fonte de verdade.
3. Remover artefatos locais criados pelo canary, quando houver.
4. Registrar no board que a ferramenta permanece `needs-canary` ou `do-not-use-here`.
