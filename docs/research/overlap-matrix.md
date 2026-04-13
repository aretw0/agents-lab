---
created: 2026-04-13
status: draft
---

# Overlap Matrix — Pi Stack (agents-lab)

## Objetivo

Mapear sobreposição entre pacotes da stack atual para decidir, por capability:

- **manter** (sem conflito relevante),
- **filtrar** (remover variante redundante na instalação),
- **migrar** (trazer para first-party),
- **consolidar** (criar primitiva/extension first-party única).

## Escopo desta rodada

- Baseado no estado atual do repositório `agents-lab`.
- Esta instância local do pi está com first-party ativa em `.pi/settings.json`.
- Third-parties foram avaliadas por leitura estática em `node_modules` + testes smoke existentes em `packages/pi-stack/test/smoke/*`.

## Resumo executivo

1. **Colisões explícitas de skill** já conhecidas e tratadas no installer (`FILTER_PATCHES`):
   - `commit`, `github`, `web-browser`, `git-workflow`, `librarian`.
2. **Conflitos explícitos de tool name**: sem novos conflitos detectados via scan automático (com ressalva do caso `bash`/`createBashTool` do `mitsupi`).
3. **Maior overlap real hoje é semântico**, não nominal:
   - Web research/fetch/browser,
   - Planning/spec/workflow,
   - Multi-agent/subagents,
   - Guard rails/governança.
4. **Web já tem direção preliminar definida**:
   - quick lookup: skill simples (temporariamente third-party),
   - deep research: `source-research` + `pi-web-access`,
   - browser interaction: `web-browser` first-party.

Referência detalhada: [`web-overlap-scorecard.md`](./web-overlap-scorecard.md).

---

## Matriz por capability

| Capability | Pacotes envolvidos | Tipo de overlap | Situação atual | Direção recomendada |
|---|---|---|---|---|
| Git skills (`commit`, `github`, `git-workflow`) | `@aretw0/git-skills`, `mitsupi`, `@ifi/oh-pi-skills` | **Nominal + semântico** | Filtrado em `FILTER_PATCHES` | **Manter first-party como winner** |
| Browser automation (CDP) | `@aretw0/web-skills/web-browser`, `mitsupi/web-browser` | **Nominal + semântico** | Filtrado em `FILTER_PATCHES` | **Manter first-party como winner** |
| Library/source research (`librarian`) | `pi-web-access`, `mitsupi`, `@aretw0/web-skills/source-research` | **Nominal + semântico** | `pi-web-access/librarian` filtrado | **Consolidar em first-party (source-research)** |
| Web search simples | `@ifi/oh-pi-skills/web-search`, `mitsupi/native-web-search`, `pi-web-access/web_search` | **Semântico** | Não filtrado por nome (sem colisão direta) | **Definir modo padrão único por contexto** |
| Web fetch/extraction | `@ifi/oh-pi-skills/web-fetch`, `pi-web-access/fetch_content` | **Semântico** | Coexistem | **Favorecer `fetch_content` em fluxos avançados** |
| Planejamento | `@ifi/pi-plan`, `@ifi/pi-spec`, `@davidorex/pi-project-workflows` | **Semântico** | Coexistem | **Avaliação comparativa dirigida por casos reais** |
| Multi-agent / delegação | `@ifi/oh-pi-ant-colony`, `@ifi/pi-extension-subagents` (+ workflows com delegação) | **Semântico** | Coexistem | **Consolidar estratégia (swarm vs subagentes)** |
| Guard rails / segurança operacional | `@ifi/oh-pi-extensions` (safe-guard, git-guard, watchdog), `@aretw0/pi-stack/read-guard` | **Semântico (camadas diferentes)** | Coexistem | **Mapear fronteiras e evitar dupla intervenção** |
| Health/runtime doctor | `@aretw0/pi-stack/environment-doctor`, possíveis checks de terceiros | **Semântico leve** | Predomínio first-party | **Manter first-party** |

---

## Zoom: Web (candidato principal de consolidação)

### O que parece overlap, mas pode ser complementar

No `@ifi/oh-pi-skills`:
- `web-search` → busca DuckDuckGo simples via script local.
- `web-fetch` → fetch e limpeza HTML básica.

No `pi-web-access`:
- `web_search`, `fetch_content`, `code_search`, `get_search_content`.
- Curator UI, múltiplos providers, extração de vídeo, PDF, clone de repositório, fluxo mais robusto.

No `@aretw0/web-skills`:
- `source-research` (playbook de pesquisa com evidências/permalinks).
- `web-browser` (automação CDP).

### Leitura prática

- **oh-pi web skills**: excelentes como primitives simples e previsíveis.
- **pi-web-access**: engine de pesquisa/extract avançada.
- **@aretw0/web-skills**: camada de estratégia/curadoria de uso (playbook).

Ou seja: há overlap funcional, mas com níveis diferentes de profundidade.

### Direção proposta (Web)

1. **Quick lookup** (leve, baixo custo):
   - manter skill simples (pode ser first-party no futuro, inspirada no `web-search` da oh-pi).
2. **Deep research** (bibliotecas, evidência, histórico):
   - padrão em `source-research` + tools de `pi-web-access`.
3. **Interactive site ops** (form/click/login):
   - padrão em `web-browser` (CDP).

---

## Colisões conhecidas (controle operacional)

### Skills

- `commit`: winner `@aretw0/git-skills`
- `github`: winner `@aretw0/git-skills`
- `web-browser`: winner `@aretw0/web-skills`
- `git-workflow`: winner `@aretw0/git-skills`
- `librarian`: winner operacional atual `mitsupi` (com `pi-web-access/librarian` filtrado)

### Extensions/tools

- Caso conhecido: `mitsupi/pi-extensions/uv.ts` interfere no `bash` (conflito histórico com `bg-process`), já tratado por filtro no installer.

---

## Próximos passos (rodada 2)

1. **Rodar experimento de uso real com third-party ativa**
   - instalar stack completa em ambiente de teste,
   - executar 6 tarefas canônicas (2 web quick lookup, 2 deep research, 2 browser automation),
   - medir: tempo, qualidade, ruído, previsibilidade.

2. **Transformar direção Web em política de instalação**
   - decidir se `web-search`/`web-fetch` da `@ifi/oh-pi-skills` ficam como fallback explícito,
   - ou se serão filtrados em `FILTER_PATCHES` para reduzir ambiguidade.

3. **Definir pacote alvo de consolidação first-party (Web)**
   - opção A: extensão `@aretw0/web-core` (tools mínimas + estáveis),
   - opção B: manter `pi-web-access` e consolidar apenas em skills/policies first-party.

4. **Expandir matriz para Planning e Multi-agent**
   - produzir winner por capability e lista de filtros recomendados.

---

## Critérios de decisão (para cada overlap)

- Valor incremental real vs duplicação
- Confiabilidade em Windows
- Custo operacional (deps, configuração, falhas)
- Qualidade da UX para o modelo (ferramentas claras, previsíveis)
- Facilidade de manutenção first-party

---

## Observação

Este documento é um artefato vivo. A cada ajuste de `FILTER_PATCHES`, mudança de composição do `@aretw0/pi-stack`, ou novo experimento de campo, atualizar este arquivo e o roadmap de migração.