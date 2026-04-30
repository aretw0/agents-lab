# Runbook: intents de internacionalização (soft/hard)

Objetivo: alinhar a língua da comunicação do agente e a língua dos artefatos gerados sem transformar preferência de conversa em tradução acidental de arquivos.

## Contrato operacional

A stack separa dois intents:

1. **Comunicação (`communication`) — soft intent**
   - orienta a língua da resposta ao usuário;
   - default: `auto-user-profile` (seguir o idioma/perfil observado do usuário);
   - pode ceder a instruções explícitas do turno, sistema, skill ou tarefa.

2. **Artefatos (`artifacts`) — hard intent**
   - governa arquivos, documentos, runbooks, evidências e mensagens persistidas;
   - default: `preserve-existing-or-user-language`;
   - deve preservar a língua predominante do arquivo existente e evitar drift misto;
   - nomes de APIs, comandos, paths, IDs, logs e evidência citada não devem ser traduzidos salvo pedido explícito.

Essa divisão evita dois erros comuns:

- responder em português e, por acidente, reescrever um documento técnico em inglês sem motivo;
- obedecer a um prompt em inglês e, por acidente, gerar artefatos fora do perfil/localidade do usuário.

## Configuração canônica

A configuração fica em `.pi/settings.json` sob `piStack.guardrailsCore.i18nIntents`.

```json
{
  "piStack": {
    "guardrailsCore": {
      "i18nIntents": {
        "enabled": true,
        "communication": {
          "language": "auto-user-profile",
          "intent": "soft"
        },
        "artifacts": {
          "language": "preserve-existing-or-user-language",
          "intent": "hard",
          "generateTranslations": false,
          "translationTargets": [],
          "rules": []
        }
      }
    }
  }
}
```

Campos principais:

| Campo | Semântica |
|---|---|
| `communication.language` | Preferência de conversa (`auto-user-profile`, `pt-BR`, `en`, etc.). |
| `communication.intent` | Deve permanecer `soft` por padrão. |
| `artifacts.language` | Política default para arquivos (`preserve-existing`, `pt-BR`, `en`, etc.). |
| `artifacts.intent` | Deve permanecer `hard` por padrão para artefatos persistidos. |
| `artifacts.generateTranslations` | `false` por default; tradução de arquivos é opt-in. |
| `artifacts.translationTargets` | Alvos default quando a tarefa pedir artefatos traduzidos. |
| `artifacts.rules[]` | Overrides por escopo/tipo de arquivo. |

## Overrides por escopo/tipo de arquivo

Use regras para exceções explícitas:

```json
{
  "piStack": {
    "guardrailsCore": {
      "i18nIntents": {
        "communication": { "language": "pt-BR", "intent": "soft" },
        "artifacts": {
          "language": "preserve-existing",
          "intent": "hard",
          "generateTranslations": false,
          "rules": [
            {
              "id": "api-docs-en",
              "pathPrefix": "docs/api",
              "extensions": [".md", ".mdx"],
              "language": "en",
              "intent": "hard",
              "generateTranslations": true,
              "translationTargets": ["pt-BR"],
              "reason": "Documentação pública de API é canônica em inglês; tradução pt-BR é artefato opt-in."
            }
          ]
        }
      }
    }
  }
}
```

Regras são aplicadas de forma determinística na ordem configurada. Uma regra pode filtrar por:

- `pathPrefix` (ex.: `docs/api`);
- `extensions` / `fileExtensions` (ex.: `.md`, `.mdx`);
- ambos ao mesmo tempo.

## Política de geração de traduções

Traduções de arquivos não são inferidas só porque a conversa está em outra língua. Para gerar tradução:

1. a tarefa precisa pedir explicitamente ou uma regra precisa habilitar `generateTranslations=true`;
2. os targets devem estar em `translationTargets` ou no escopo da tarefa;
3. o artefato traduzido deve ser separado ou claramente marcado;
4. a verificação deve registrar o motivo e os arquivos produzidos.

## Auditoria esperada

Quando o runtime estiver carregado, `guardrails-core` injeta no system prompt uma política curta e registra auditoria `guardrails-core.i18n-intent-policy` com resumo como:

```text
comm=pt-BR/soft artifact=preserve-existing/hard translations=off rules=1
```

Para tarefas de docs/política, registre na verificação:

- idioma pretendido do artefato;
- se houve preservação da língua existente;
- se houve tradução opt-in;
- exceções intencionais (termos técnicos, logs, comandos, nomes de API).

## Lint i18n-aware para texto user-facing

A stack expõe uma primitiva read-only para lint leve de texto persistido ou user-facing: `i18n_lint_text`. Ela não traduz, não muta arquivos e não autoriza dispatch; apenas sinaliza risco de drift de idioma em entrada bounded.

Use quando uma fatia alterar mensagens, docs, runbooks, README, evidências ou strings de UI e houver risco de mistura acidental de idiomas. A primitiva ignora code fences, comandos, paths, URLs, IDs de task/verificação e evidência técnica curta para reduzir falso positivo.

Política operacional:

- `decision=pass`: sem drift óbvio pelo heurístico local;
- `decision=warn`: revisar trecho com mistura provável ou idioma inesperado;
- `decision=invalid`: entrada grande demais ou inválida; reduzir escopo antes de validar;
- `authorization=none`, `dispatchAllowed=false`, `mutationAllowed=false` sempre.

Exemplo de uso conceitual:

```text
i18n_lint_text(text=<trecho user-facing>, expected_language=pt-BR, max_text_chars=12000)
```

Esse lint é auxiliar; o hard intent de artefatos continua sendo a fonte de verdade.

## Drift detection opcional com `mdt`

Se o projeto usar `mdt` ou ferramenta equivalente de análise textual, ela pode ser adicionada como verificação auxiliar para detectar drift em trechos comuns multi-idioma:

- varrer somente arquivos alterados ou escopos pequenos;
- sinalizar mistura inesperada de idiomas em parágrafos longos;
- ignorar code fences, comandos, paths, IDs, logs e nomes de API;
- manter o gate como advisory/local até a taxa de falso positivo ser calibrada.

Exemplo de política (pseudo):

```text
mdt --changed-only --ignore-code --languages pt-BR,en --report i18n-drift
```

O `mdt` não substitui o hard intent: ele só fornece evidência adicional para revisão.

## Defaults para long-run/unattended

Em execução longa:

- continuar usando `communication.language` como soft preference;
- aplicar `artifacts` como hard intent para arquivos persistidos;
- não iniciar tradução ampla sem opt-in;
- não alterar `.pi/settings.json` só para satisfazer uma task — documentar a política e deixar o usuário optar;
- se houver conflito entre idioma do arquivo e idioma do turno, preservar o arquivo e mencionar a escolha na evidência.
