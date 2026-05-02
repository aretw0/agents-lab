# Testando Extensões e Temas em Isolamento

Ao desenvolver extensões, temas ou qualquer customização pi, você precisa
testar em isolamento para evitar interferência das configurações da sessão ativa.

## Modelo de inicialização do pi

Cada invocação `pi` em um terminal é um **processo OS independente**.
Não há herança de estado entre instâncias. O que é compartilhado é apenas o estado em disco:

| O que é compartilhado | Onde vive | Isolável? |
|---|---|---|
| Auth / tokens | `~/.pi/agent/settings.json` | Sim — via `PI_CODING_AGENT_DIR` |
| Config global | `~/.pi/agent/settings.json` | Sim — via `PI_CODING_AGENT_DIR` |
| Config do projeto | `.pi/settings.json` | Sim — via flags `--no-*` |
| Histórico de sessões | `~/.pi/agent/sessions/` | Sim — via `--no-session` |

## Níveis de isolamento

### Nível 1 — Só o tema, sem extensões nem skills

Abra um **novo terminal** na raiz do projeto e execute:

```bash
pi --no-session \
   --no-extensions \
   --no-skills \
   --no-prompt-templates \
   --theme packages/pi-stack/themes/agents-lab.json
```

Isso carrega apenas o tema especificado, ignorando todo o `settings.json`.
Útil para avaliar aparência sem interferência de extensões.

### Nível 2 — Só a extensão que você está desenvolvendo

```bash
pi --no-session \
   --no-extensions \
   --no-skills \
   -e packages/pi-stack/extensions/guardrails-core.ts
```

O flag `-e` (ou `--extension`) é repetível — você pode combinar com outros arquivos explicitamente.

### Nível 3 — Configuração completamente virgem

Cria um diretório de config temporário separado do `~/.pi/agent/`:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-test-env \
  pi --no-session \
     --theme packages/pi-stack/themes/agents-lab.json
```

Vai pedir login novamente — útil para simular a experiência de um novo usuário
(por exemplo, validar o fluxo de `pi install https://github.com/aretw0/agents-lab`).

### Nível 4 — Testar o install completo do zero

```bash
mkdir /tmp/pi-install-test && cd /tmp/pi-install-test
PI_CODING_AGENT_DIR=/tmp/pi-fresh-config pi install https://github.com/aretw0/agents-lab
PI_CODING_AGENT_DIR=/tmp/pi-fresh-config pi
```

## Combinações úteis por caso de uso

| Objetivo | Comando |
|---|---|
| Ver o tema aplicado | `pi --no-session --no-extensions --no-skills --no-prompt-templates --theme packages/pi-stack/themes/agents-lab.json` |
| Testar uma extensão isolada | `pi --no-session --no-extensions -e packages/pi-stack/extensions/environment-doctor.ts` |
| Testar com stack completa mas sem salvar | `pi --no-session` |
| Simular novo usuário | `PI_CODING_AGENT_DIR=/tmp/pi-test pi --no-session` |
| Testar no mesmo dir sem projeto settings | `pi --no-session --no-extensions --no-skills` |

## O que NÃO muda entre instâncias

- A autenticação (`/login`) é sempre salva em `~/.pi/agent/settings.json` (ou em `PI_CODING_AGENT_DIR`)
- Instâncias no mesmo diretório com `settings.json` do projeto carregam a mesma config de projeto

## Testando o tema agents-lab

O tema vive em `packages/pi-stack/themes/agents-lab.json`. Temas têm hot-reload —
enquanto uma sessão com o tema ativo está aberta, editar o arquivo aplica as mudanças
imediatamente sem precisar reiniciar.

Para avaliar syntax highlighting de código especificamente, peça ao pi algo que gere
blocos de código TypeScript ou bash depois de abrir com o comando de nível 1 acima.

## Isolamento + contexto fresh (pós-compact)

Ao testar spawn simples ou swarm, prefira injetar um **fresh context pack** mínimo
(derivado de `.project/handoff.json`, recorte de tasks foco e última verificação)
em vez de reler árvore ampla de docs/logs.

Se o pack estiver stale (handoff/task/verification mudou), descarte e regenere antes
de iniciar o agente isolado. Isso mantém o teste reproduzível e reduz custo de contexto.
