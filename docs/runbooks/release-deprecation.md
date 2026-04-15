# Runbook — Deprecar release publicada com problema

Use este procedimento quando uma versão foi publicada, mas não deveria ser usada.

## 1) Pré-check

```bash
npm whoami
npm view @aretw0/pi-stack versions --json --prefer-online
```

Se `npm whoami` falhar, faça login (`npm login`) ou use um token com permissão de owner.

## 2) Dry-run da depreciação

```bash
npm run release:deprecate -- --version 0.3.10
```

## 3) Executar depreciação

```bash
npm run release:deprecate -- --version 0.3.10 --yes
```

Mensagem padrão:

`broken release; do not use this version. Use latest stable.`

Mensagem custom:

```bash
npm run release:deprecate -- --version 0.3.10 --message "broken CI release; use >= 0.4.1" --yes
```

## 4) Verificar resultado

```bash
npm view @aretw0/pi-stack@0.3.10 deprecated --prefer-online
npm view @aretw0/git-skills@0.3.10 deprecated --prefer-online
npm view @aretw0/web-skills@0.3.10 deprecated --prefer-online
npm view @aretw0/pi-skills@0.3.10 deprecated --prefer-online
npm view @aretw0/lab-skills@0.3.10 deprecated --prefer-online
```

## 5) Comunicação pós-incidente

- abrir/atualizar nota no PR/release explicando motivo
- apontar versão segura substituta
- registrar no changelog interno

## Observações

- Deprecar **não remove** o pacote do registry; apenas alerta consumidores.
- Para remover aviso em uma versão específica, rode `npm deprecate <pkg>@<ver> ""` (mensagem vazia).
