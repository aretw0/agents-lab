# Roadmap - agents-lab

Este roadmap mantém direção macro. O estado diário vive em `.project/*`; evidência datada fica em `docs/research/`; contratos estáveis devem ser promovidos para `docs/guides/`, `docs/primitives/` ou `docs/architecture/`.

## Norte

O `agents-lab` deve entregar uma stack local-first para agentes de IA que seja:

- pequena no uso diário;
- explícita sobre custo, quota, cache, publish e automação;
- testável por CI e smoke local;
- extensível por primitives e adapters;
- compatível com Pi hoje e preparada para Refarm como engine futura.

Pi continua sendo a primeira engine operacional. Refarm é a próxima fronteira de compatibilidade, então novas primitivas devem separar core de runtime adapter.

## Estado Atual

| Área | Estado |
|---|---|
| Monorepo | `pnpm`, packages first-party e devcontainer operando como baseline |
| Distribuição | `@aretw0/pi-stack` e skills first-party preparados por changesets, com publish npm gateado por tag semver |
| CI | GitHub Actions com pins, permissões explícitas, paridade local e publish tag-gated |
| Site | GitHub Pages minimalista via Jekyll Hacker, com navegação pública pequena |
| Devcontainer | `lab pi`, Node 24, pnpm global bin, cache de assistentes e ferramentas básicas |
| Runtime Pi | `pi:dev` com perfil control-plane e capacidades caras frias por padrão |
| Fronteira de engine | `engine:boundary:audit` exige core portable e deixa Pi em surfaces/adapters |
| Docs | README e site separados por usuário, mantenedor, operador e arquitetura |

## 0.8.0 - Convergência

Objetivo: publicar uma baseline madura da `pi-stack` e do laboratório sem prometer automação forte antes dos gates.

### 1. Baseline Operacional

- manter `ci:local:parity` e GitHub Actions verdes;
- manter devcontainer e host com comandos equivalentes;
- garantir instalação `npx @aretw0/pi-stack` e `pi install` sem surpresa;
- manter publish com provenance, tag semver e cache de dependência desligado em job privilegiado;
- manter docs publicadas testadas localmente e no Pages.

### 2. Curadoria da pi-stack

- preservar `strict-curated` como default;
- manter extras caros como opt-in;
- reduzir colisões e duplicações de skills/tools por filtro ou first-party ownership;
- separar manutenção genérica distribuível de manutenção específica do laboratório;
- manter terceiros curados documentados sem vender dependência externa como first-party.

### 3. Primitives Portáveis

- manter `engine:boundary:audit` sem exceções para core acoplado;
- manter core sem import direto de `@earendil-works/pi-coding-agent`;
- expor Pi por surfaces/adapters;
- preparar contratos de board, intent, approval, cache, release e runtime health para futura engine Refarm;
- evitar renomear pacotes por antecipação quando um contrato e um teste resolvem melhor.

### 4. Control Plane

- manter execução local-safe como default;
- promover delegação e long-run apenas por packets report-only, canários e rollback;
- usar milestones como unidade de continuidade;
- preservar operador como origem de intenção, aprovação e orçamento;
- evitar que diagnósticos pesados entrem no hot path sem sinal.

### 5. Release Readiness

- gerar relatório de readiness apenas quando CI, docs, installer e pacote estiverem coerentes;
- revisar changelog/release notes antes de tag;
- validar instalação e smoke em ambiente limpo;
- publicar somente com tag semver, provenance e rollback/deprecation documentado.

## Depois da 0.8.0

| Tema | Direção |
|---|---|
| Refarm engine | criar adapter quando a engine estiver pronta, reaproveitando primitives já desacopladas |
| Workers e colônia | promover de report-only para execução apenas com métricas, budget e cancelamento confiáveis |
| GitHub Actions como executor | manter protegido até existir contrato de task, artifact, rollback e permissão mínima |
| Provider routing | canários pequenos, quota visível e decisão explícita antes de troca real |
| Docs distribuídas | sincronizar guias genéricos para pacotes, mantendo docs do laboratório fora do pacote |
| Site público | manter navegação curta; research só aparece quando vira evidência selecionada |

## Não Objetivos Agora

- trocar Pi por outra engine;
- publicar automação remota forte sem gates locais;
- criar pacote novo só por nomenclatura;
- transformar `.project` em banco definitivo;
- misturar docs internas de manutenção com guias de usuário;
- perseguir toda influência externa antes de estabilizar a baseline local.

## Gates De Mudança

Antes de promover uma lane como pronta, valide pelo menor conjunto relevante:

```bash
pnpm run test:docs:site
pnpm run test:ci:workflow
pnpm run test:engine:boundary
pnpm run engine:boundary:audit
pnpm run ci:local:parity
```

Use `ci:local:parity` para mudanças em runtime compartilhado, empacotamento, CI, release ou superfície pública. Para docs simples, prefira `test:docs:site`, `repo:discourse:audit` e `docs:package:check`.
