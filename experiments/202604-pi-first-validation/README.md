# Primeira Validação Real do Pi

**Data:** 2026-04-09  
**Engine:** Pi  
**Status:** Concluído

## Objetivo

Validar a adoção inicial do Pi no ambiente real do laboratório, incluindo:

- instalação no Windows
- autenticação com provider real
- montagem da stack mínima
- observação dos artefatos que o uso do Pi e das extensões materializam no workspace

## Configuração

Ambiente validado:

- Windows
- Git Bash disponível em `C:\Program Files\Git\bin\bash.exe`
- Node.js `v22.19.0`
- npm `11.6.2`
- Pi `0.66.1`
- provider autenticado: `github-copilot`

Comandos executados na validação:

```bash
npm install -g @mariozechner/pi-coding-agent
pi --version
pi --list-models
npx @ifi/oh-pi
pi install npm:pi-lens
pi install npm:@davidorex/pi-project-workflows
pi install npm:pi-web-access
```

Teste funcional mínimo do core do Pi:

```bash
pi --provider github-copilot --model gpt-5.4 --no-tools --no-extensions --no-skills --no-prompt-templates -p "Responda exatamente: OK"
```

## Resultados

### 1. O core do Pi está funcional

- `pi --version` respondeu corretamente
- `pi --list-models` listou modelos do `github-copilot`
- um prompt real em modo isolado respondeu `OK`

Conclusão: o Pi ficou pronto para uso real, não apenas instalado.

### 2. A stack mínima foi instalada

Pacotes ativos após a validação:

- componentes do `oh-pi`
- `pi-lens`
- `@davidorex/pi-project-workflows`
- `pi-web-access`

Esses pacotes foram persistidos em `~/.pi/agent/settings.json`.

### 3. Extensões geram estado local no workspace

O uso do Pi com a stack instalada materializou diretórios locais no projeto:

- `.pi/monitors/`
- `.pi-lens/cache/`

Isso é um comportamento importante do ecossistema Pi: extensões não apenas alteram o runtime do agente, elas também podem projetar configuração, monitores, cache e outros artefatos para dentro do repositório.

No caso observado:

- `.pi/monitors/` veio do conjunto de behavior monitors de `pi-project-workflows`
- `.pi-lens/cache/` veio do `pi-lens`

### 4. Nem tudo que aparece no workspace deve ser commitado automaticamente

Esta validação mostrou uma distinção útil:

- **configuração intencional de projeto**: pode merecer versionamento
- **estado gerado, cache ou bootstrap operacional**: tende a ser ruído e deve ser ignorado por padrão

Nesta primeira rodada, a decisão foi:

- ignorar `.pi-lens/`
- ignorar `.pi/monitors/`
- não ignorar a pasta `.pi/` inteira, para preservar a possibilidade de no futuro versionarmos arquivos intencionais de projeto nela

### 5. Houve um atrito real com a stack

O bundle `oh-pi` falhou parcialmente ao instalar `@ifi/oh-pi-extensions`, embora o mesmo pacote tenha instalado corretamente quando executado isoladamente.

Também apareceu um erro auxiliar de `hedge` quando o Pi foi executado com a stack completa carregada. A origem observada foi:

- `@davidorex/pi-project-workflows`
- `@davidorex/pi-behavior-monitors`
- monitor `hedge`

Importante: esse erro não impediu a resposta principal do modelo. O problema está em um monitor auxiliar, não no core do Pi nem no login.

### 6. A resposta do laboratório não deve ser limpeza imediata

Esta primeira validação também definiu uma regra metodológica importante para o laboratório:

- comportamento opinativo de extensão deve ser investigado antes de ser removido
- artefatos inesperados no workspace devem ser tratados como dado de pesquisa
- erros auxiliares devem ser entendidos na sua origem antes de virar "higiene"

No caso do `hedge`, a próxima ação correta não é desligar o monitor por reflexo. É entender:

- por que ele existe
- o que ele tenta classificar
- por que falha neste contexto
- se ele revela uma expectativa válida do ecossistema Pi ou apenas um acoplamento ruim

## Conclusões

- O Pi já está validado para uso prático no laboratório.
- O uso real de extensões Pi pode povoar o repositório com diretórios opinativos e operacionais.
- O laboratório precisa tratar a pasta `.pi/` como uma superfície de design, não apenas como detalhe técnico.
- No futuro, faz sentido termos artefatos nossos dentro de `.pi/`, mas isso deve ser uma decisão explícita de arquitetura, não efeito colateral aceito sem curadoria.
- O laboratório deve investigar comportamento opinativo antes de limpar ou desabilitar componentes.

## Próximos passos sugeridos

1. validar um workflow real de planejamento com `/spec` ou `pi-project-workflows`
2. entender o monitor `hedge` antes de decidir se ele deve ser isolado, reconfigurado ou mantido
3. decidir quais artefatos de projeto do Pi queremos tornar parte estável do repositório
4. testar uma primeira sessão de pesquisa web com `pi-web-access`
