# Protected-scope Classification Criteria (local-safe synthesis) — 2026-05-01

## Objetivo

Mapear critérios usados pelo seletor de lane para marcar tasks como `protected-scope`, reduzindo surpresa operacional e falso-positivo em pesquisa **local-safe**.

Fonte local:
- `packages/pi-stack/extensions/guardrails-core-autonomy-task-selector.ts`

## Matriz curta de critérios

### Classifica como protected (positivo)

1. **Arquivos protegidos explícitos**
   - `.pi/settings.json`
   - `.obsidian/**`
   - `.github/**` / `workflows/**`
2. **Execução remota / CI / publish** no texto
   - `github actions`, `remote execution`, `publish`, `ci`
3. **Temas de colony promotion/recovery**
   - `colony + promotion/recovery/materialização`
4. **Pesquisa externa explícita**
   - URL (`http://` / `https://`), ou
   - `pesquisa/research` combinada com `externa/external/web/internet/source/influência/inspiration/prior art`

### Não classifica como protected (negativo)

1. Pesquisa com escopo local explícito, sem sinal externo
   - exemplo: `pesquisa local-safe: mapear critérios de classificação protected`
2. Task de documentação/análise local sem `.github/.obsidian/.pi/settings.json` e sem palavras de remote/CI/publish.

## Ajuste de baixo risco aplicado

- Removido gatilho amplo de `pesquisa/research` isolado (gerava falso-positivo em task local-safe).
- Mantido bloqueio para pesquisa **externa** (URL/sinais externos), preservando governança fail-closed.

## Evidência de regressão

- `packages/pi-stack/test/smoke/autonomy-task-selector.test.ts`
  - external research continua protected;
  - local-safe research criteria task permanece elegível.
