# @aretw0/web-skills

> First-party web skills para o agents-lab — automação de browser via CDP.

## Skills

| Skill | Descrição |
|---|---|
| `web-browser` | Automação de browser via Chrome DevTools Protocol — navegar, screenshot, JS eval, click, logs de rede |

## Uso

```bash
pi install npm:@aretw0/web-skills
```

Ou via projeto:

```json
{
  "packages": ["./packages/web-skills"]
}
```

### web-browser — dependência

A skill `web-browser` usa WebSocket (via `ws`) para comunicação CDP. A dependência é declarada no `package.json` do `@aretw0/web-skills`; installs publicados não precisam de install separado. Ao rodar a partir do código-fonte deste repositório, use o install do workspace na raiz.

## Filosofia

`web-browser` é CDP puro — sem Playwright, sem Puppeteer, sem overhead. Ponto de partida do `mitsupi/web-browser` (MIT) com SKILL.md reescrito e scripts owned.

A busca web é coberta pelo `pi-web-access` via tool `web_search` direta — mais eficiente do que um script intermediário.

## Proveniência

| Skill | Baseada em |
|---|---|
| `web-browser` | `mitsupi/skills/web-browser` (MIT) — SKILL.md reescrito, scripts owned |

## Instalação via git

Para a versão mais recente sem esperar publish:

```bash
pi install https://github.com/aretw0/agents-lab
```

Isso instala todos os pacotes `@aretw0/*` de uma vez.

## Repositório

[github.com/aretw0/agents-lab](https://github.com/aretw0/agents-lab)

## Licença

MIT
