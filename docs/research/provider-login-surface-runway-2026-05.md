# Provider login surface runway — 2026-05

Status: report-only / local-safe  
Tarefa: `TASK-BUD-898`  
Escopo relacionado: `TASK-BUD-849` permanece protegido para qualquer mudança de provider/model/settings/routing/API.  
Este packet não implementa comando runtime `/login`, registro de provider, armazenamento de credenciais ou mutação de settings.

## 1. Requirement assimilado

Se um provider candidato não tiver fluxo de login nativo no pi, a assimilação deve incluir um caminho fácil de configuração via `/login <provider>` ou equivalente antes de virar provider operacional.

Objetivo prático:

- evitar configuração frágil/manual toda vez que trocar provider;
- reduzir atrito para testar free trials sem vazar segredo para o repositório;
- deixar autenticação, refresh, rollback e telemetry explícitos antes de qualquer gasto ou roteamento;
- preservar o modelo mental do operador: provider novo precisa ser fácil de ativar, desativar e auditar.

## 2. Superfícies existentes no pi

### `models.json`

O pi permite providers/modelos customizados via `~/.pi/agent/models.json`.

Pontos úteis:

- `apiKey` pode resolver por variável de ambiente, literal ou comando shell prefixado por `!`;
- `baseUrl`, `api`, `headers`, `authHeader`, `models`, `modelOverrides` configuram providers;
- providers OpenAI-compatible geralmente usam `api: "openai-completions"`;
- compat flags cobrem diferenças como `supportsDeveloperRole`, `supportsReasoningEffort`, `thinkingFormat: "qwen"` e `maxTokensField`;
- `/model` recarrega `models.json` ao abrir, mas isso não é um fluxo de login por si só.

Uso recomendado para assimilação: bom para smoke manual com segredo fora do repo, mas insuficiente se o objetivo for login fácil/repetível.

### `pi.registerProvider(... oauth ...)`

Extensões podem registrar providers com OAuth integrado ao `/login`.

Contrato relevante:

- `pi.registerProvider("provider-id", { ... oauth: { name, login, refreshToken, getApiKey, modifyModels? } })`;
- o usuário autentica com `/login provider-id`;
- credenciais OAuth ficam em `~/.pi/agent/auth.json`;
- `login(callbacks)` pode usar browser URL, device code ou prompt manual;
- `refreshToken(credentials)` mantém acesso sem pedir login a cada uso;
- `modifyModels` pode ajustar baseUrl/modelos conforme conta/região/tenant.

Exemplos lidos:

- `custom-provider-qwen-cli`: device code + PKCE, provider `qwen-cli`, base URL DashScope compatible, uso de `/login qwen-cli`, `thinkingFormat: "qwen"` para modelo vision/reasoning.
- `custom-provider-gitlab-duo`: OAuth + direct access token interno + `streamSimple` customizado.
- `custom-provider-anthropic`: OAuth e stream customizado como referência para providers não triviais.

## 3. Decisão de design

Para cada provider candidato, o activation packet deve escolher uma destas trilhas:

| Trilha | Quando usar | Resultado esperado |
| --- | --- | --- |
| Native `/login` existente | pi já suporta login do provider ou exemplo confiável cobre o caso | documentar comando, rollback e telemetry |
| Custom provider OAuth | provider oferece OAuth/device-code/refresh viável | extensão registra `oauth` e provider antes da ativação |
| API key login-equivalent | provider só oferece API key | criar fluxo equivalente seguro: checklist/wizard local para env/secret manager, sem segredo no repo |
| `models.json` manual | apenas smoke descartável | permitido só como etapa manual curta, não como experiência final |

Regra: provider sem login nativo não deve virar rota default, monitor provider ou provider recorrente antes de existir `/login` ou equivalente operacional.

## 4. Gate para providers sem login nativo

Antes de implementar qualquer runtime:

1. Identificar se o provider já aparece em `/login` ou exemplos de provider.
2. Confirmar auth flow oficial: OAuth, device code, console API key ou token de serviço.
3. Confirmar onde o segredo fica armazenado.
4. Garantir que nenhum segredo entra no repositório, `.project`, docs ou logs.
5. Definir logout/rollback: remover auth, env var, secret manager entry e provider registration.
6. Definir refresh/expiry behavior.
7. Definir fallback quando auth expira durante monitor loop.
8. Definir smoke com prompt sintético e cap de custo.
9. Definir telemetry mínima: provider/model/tokens/request/cost ou lacunas explícitas.
10. Definir mensagem clara para operador quando login não está configurado.

## 5. Alibaba específico

Para Alibaba, confirmar primeiro:

- existe `/login` nativo no pi para Alibaba/Qwen/DashScope?
- o exemplo `qwen-cli` cobre a conta Alibaba free trial do operador ou é específico de `chat.qwen.ai`?
- DashScope da conta Alibaba usa API key, OAuth/device-code ou ambos?
- o endpoint correto é `https://dashscope.aliyuncs.com/compatible-mode/v1` ou outro por região/conta?
- modelos Qwen disponíveis no free trial são compatíveis com `openai-completions`?
- `thinkingFormat: "qwen"` é necessário para quais modelos?
- API key pode ser guardada em env/secret manager sem arquivo versionado?
- dashboard mostra usage suficiente para validar trial burn?

Se não houver login nativo, o candidate packet da Alibaba deve propor um fluxo `/login alibaba` ou `/login qwen-cli` validado antes de qualquer `routeModelRefs`, `providerBudgets` ou monitor migration.

## 6. Backlog protegido futuro

Implementação runtime possível, mas ainda não autorizada:

- extensão `provider-login-assimilation` ou provider-specific `alibaba-provider`;
- comando/wizard de setup equivalente a `/login` quando só houver API key;
- smoke command report-only para verificar auth sem salvar segredo;
- integração com quota telemetry para provider novo;
- teste de regressão garantindo que provider sem login/config não aparece como pronto.

Essas mudanças tocam provider/runtime/auth/settings e devem entrar apenas por packet protegido ligado a `TASK-BUD-849`.

## 7. Próximo passo local-safe

Atualizar packets de provider para incluir uma seção obrigatória: **Login/configuração**.

Para Alibaba, preencher essa seção quando o operador trouxer do dashboard:

- produto/API escolhido;
- modelos disponíveis;
- método de auth;
- saldo/expiração do trial;
- política de cobrança automática;
- endpoint/região.
