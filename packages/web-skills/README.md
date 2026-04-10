# @aretw0/web-skills

> First-party web skills para o agents-lab — pesquisa nativa e automação de browser via CDP.

## Skills

| Skill | Descrição |
|---|---|
| `native-web-search` | Pesquisa web via modelo com search nativo — retorna resumo conciso com URLs canônicas |
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

### web-browser — setup inicial

A skill `web-browser` usa WebSocket (via `ws`) para comunicação CDP. Antes do primeiro uso:

```bash
npm install --prefix packages/web-skills/skills/web-browser/scripts
```

## Filosofia

Ponto de partida: `mitsupi/native-web-search` e `mitsupi/web-browser` (MIT).

A escolha de partir da simplicidade do mitsupi é intencional:
- `native-web-search` usa o próprio modelo com search nativo — sem APIs externas, sem chaves extras
- `web-browser` é CDP puro — sem Playwright, sem Puppeteer, sem overhead

Conforme a curadoria avança, outras abordagens (`@ifi/web-search`, `pi-web-access`) serão avaliadas comparativamente. As melhores primitivas serão absorvidas aqui; o restante permanece no `pi-stack` para referência.

## Proveniência

| Skill | Baseada em |
|---|---|
| `native-web-search` | `mitsupi/skills/native-web-search` (MIT) |
| `web-browser` | `mitsupi/skills/web-browser` (MIT) — SKILL.md reescrito, scripts owned |
