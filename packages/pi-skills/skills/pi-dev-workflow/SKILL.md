---
name: pi-dev-workflow
description: >
  Como configurar o workflow de desenvolvimento de extensões e pacotes pi.
  Use quando o usuário estiver desenvolvendo extensões em um monorepo, precisar
  alternar entre código local e pacotes publicados, ou tiver conflitos de
  carregamento de pacotes.
---

# Workflow de Desenvolvimento Pi

Desenvolver extensões, skills ou temas para o pi exige alternar entre **código local** (para iterar rápido) e **pacotes publicados** (para validar a experiência do usuário final). Esta skill documenta os padrões que funcionam.

## O Problema

Quando você desenvolve um pacote pi dentro de um monorepo, surgem 3 conflitos comuns:

1. **O pi carrega a versão publicada** em vez do código local que você está editando
2. **npm workspaces faz hoisting** — deps vão para `root/node_modules/` e paths relativos quebram
3. **`bundledDependencies` não funciona** com workspaces — o tarball sai vazio

## Solução: Source Switching

O padrão adotado pelo [oh-pi](https://github.com/ifiokjr/oh-pi) e pelo [agents-lab](https://github.com/aretw0/agents-lab):

1. **Cada pacote é independente** — publicado no npm com seu próprio `package.json`
2. **Um script alterna** entre paths locais e `npm:@scope/name` no `settings.json` do pi
3. **Sem `bundledDependencies`** — meta-pacotes são installers que rodam `pi install` para cada dependência

### Configuração Mínima (pacote único)

Para um pacote simples, basta usar `pi install` com path local:

```bash
# Desenvolvimento — carrega do disco
pi install /caminho/absoluto/para/meu-pacote

# Produção — volta para npm
pi remove /caminho/absoluto/para/meu-pacote
pi install npm:@meu-scope/meu-pacote
```

### Configuração Monorepo (múltiplos pacotes)

Crie um script que reescreve o `settings.json` do pi:

```javascript
#!/usr/bin/env node
// scripts/pi-source-switch.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Descobrir pacotes pi no workspace
const PACKAGES = new Map();
for (const entry of readdirSync(path.join(REPO_ROOT, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgPath = path.join(REPO_ROOT, "packages", entry.name, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.keywords?.includes("pi-package")) {
    PACKAGES.set(pkg.name, path.join(REPO_ROOT, "packages", entry.name));
  }
}

const mode = process.argv[2]; // "local" ou "published"
const settingsPath = path.join(homedir(), ".pi", "agent", "settings.json");
const settings = existsSync(settingsPath)
  ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};

const newPackages = [];
for (const [name, dir] of PACKAGES) {
  newPackages.push(mode === "local" ? path.resolve(dir) : `npm:${name}`);
}
settings.packages = newPackages;

mkdirSync(path.dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`✅ Switched to ${mode} mode. Restart pi to reload.`);
```

E no `package.json`:

```json
{
  "scripts": {
    "pi:local": "node scripts/pi-source-switch.mjs local",
    "pi:published": "node scripts/pi-source-switch.mjs published"
  }
}
```

### Uso

```bash
npm run pi:local       # pi carrega do workspace
npm run pi:published   # pi carrega do npm
```

## Configuração do Projeto (.pi/settings.json)

Para quem clona o monorepo e quer usar com pi imediatamente:

```json
{
  "packages": [
    "../packages/meu-pacote",
    "../packages/outro-pacote"
  ]
}
```

Paths são relativos ao `.pi/` (onde o settings.json fica). O pi carrega automaticamente.

**Projeto vs. global:** `.pi/settings.json` é para a equipe (versionado). `~/.pi/agent/settings.json` é individual (o `pi:local`/`pi:published` altera este). Ambos coexistem.

## Antipadrões a Evitar

### ❌ bundledDependencies em monorepos npm

```json
{
  "dependencies": { "outro-pacote-pi": "*" },
  "bundledDependencies": ["outro-pacote-pi"]
}
```

npm workspaces faz hoisting → `node_modules/` local vazio → tarball sem deps → pacote quebrado.

**Solução:** Installer que roda `pi install npm:X` para cada pacote.

### ❌ postinstall para forçar deps locais

```json
{ "scripts": { "postinstall": "npm install --prefix packages/x --no-workspaces" } }
```

Hack frágil que duplica deps e não resolve o tarball publicado.

### ❌ Editar o pacote que o pi está carregando

Editar extensões carregadas na sessão ativa causa conflitos. Use `/reload` ou reinicie o pi.

## Estrutura Recomendada

```text
meu-monorepo/
├── packages/
│   ├── extensions/     # @scope/extensions — pi-package
│   ├── skills/         # @scope/skills — pi-package
│   └── themes/         # @scope/themes — pi-package
├── scripts/
│   └── pi-source-switch.mjs
├── .pi/
│   └── settings.json   # Paths locais para equipe
└── package.json        # scripts pi:local, pi:published
```

Cada pacote: `"keywords": ["pi-package"]`, seção `"pi": {}`, sem `bundledDependencies`.

## Referências

- [oh-pi source switcher](https://github.com/ifiokjr/oh-pi) — `scripts/pi-source-switch.mts`
- [agents-lab](https://github.com/aretw0/agents-lab) — implementação de referência
- Skills relacionadas: `create-pi-extension`, `create-pi-skill`, `test-pi-extension`
