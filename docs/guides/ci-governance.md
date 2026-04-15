# CI Governance — Troubleshooting dos gates de soberania

Guia rápido para diagnosticar e corrigir falhas de governança no CI.

## Onde os checks rodam

No workflow `CI`:

- **Gate de bloqueio (job `smoke`)**
  - `npm run audit:sovereignty`
  - `npm run audit:sovereignty:diff`
- **Visibilidade (job `sovereignty-report`)**
  - artifact `stack-sovereignty-audit`
  - comentário de PR com `<!-- stack-sovereignty-report -->`

## Falhas comuns e correções

### 1) Missing capability annotations (required)

Erro típico:

```text
packages/pi-stack/extensions/<arquivo>.ts: missing capability annotations (required)
```

**Causa:** extensão alterada com `registerCommand/registerTool/pi.on` sem anotação no header.

**Como corrigir:** adicionar no topo do arquivo:

```ts
/**
 * @capability-id <id-kebab-case>
 * @capability-criticality high|medium|low
 */
```

Depois rode localmente:

```bash
npm run audit:sovereignty:diff
```

---

### 2) High critical capability ausente no registry

Erro típico:

```text
high critical capability '<id>' is not present in capability-owners.json
```

**Causa:** annotation `high` criada sem registrar ownership.

**Como corrigir:** incluir capability em:

- `packages/pi-stack/extensions/data/capability-owners.json`

Campos mínimos:

- `id`
- `criticality`
- `primaryPackage`
- `coexistencePolicy`
- `defaultAction`

Validação:

```bash
npm run audit:sovereignty
npm run audit:sovereignty:diff
```

---

### 3) Criticality mismatch (code vs registry)

Erro típico:

```text
criticality mismatch for '<id>' (code=high, registry=medium)
```

**Causa:** valor de `@capability-criticality` difere do registry.

**Como corrigir:** alinhar **um** source of truth (normalmente registry + annotation juntos).

---

### 4) Owner missing em capability crítica (runtime audit)

Erro típico no audit estrito:

```text
critical capability owner missing at runtime: <id>
```

**Causa provável:** package owner não está presente na configuração avaliada.

**Como corrigir:**

1. conferir `.pi/settings.json` (`packages` ativos)
2. aplicar baseline/reload
3. confirmar owner primário no registry

---

## Checklist local antes de abrir PR

```bash
npm run audit:sovereignty
npm run audit:sovereignty:diff
npm run test:smoke
npm test
```

## Referências

- `docs/guides/stack-sovereignty-user-guide.md`
- `docs/guides/extension-acceptance-checklist.md`
- `docs/architecture/stack-sovereignty-rfc-2026-04.md`
- `docs/runbooks/release-deprecation.md`
