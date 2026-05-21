# Mini-Handoff Template

Use ao fechar cada micro-lote de trabalho. O objetivo é permitir parada, retomada ou compactação sem perder decisão, evidência e próximo passo.

## Ritual de fechamento (5-10 min)
1. Rodar a verificação local equivalente ao escopo da fatia.
2. Rodar a tool/comando de validação do projeto, quando existir.
3. Registrar status curto: arquivos tocados, evidência, riscos e WIP.
4. Atualizar o handoff/checkpoint canônico do projeto com delta curto.
5. Garantir que a próxima frente ativa esteja explícita.

## 1) Decisões fechadas neste lote
- 
- 
- 

## 1-bis) Protocolo de parada
- [ ] Gates determinísticos relevantes foram consultados antes de continuar, delegar ou parar.
- [ ] Se houver bloqueio: registrar `ask-operator` com uma pergunta objetiva e uma ação segura proposta.
- [ ] Registrar contexto útil, ROI da próxima ação e o que não foi escolhido.
- IDs continuam úteis como ponteiro, mas nunca devem ficar sozinhos sem contexto de impacto/decisão.

## 2) Evidências rápidas
- Arquivos lidos/editados:
- Comandos/tools usados:
- Riscos encontrados:

## 3) Pendências imediatas
- 
- 

## 4) Próximos 3 passos (obrigatório)
1. 
2. 
3. 

## 5) Gatilho de consolidação
- [ ] Contexto saudável (seguir)
- [ ] Contexto em risco (parar e abrir novo lote)

## 6) Snapshot para próxima sessão
- Arquivo de entrada recomendado:
- Task(s) envolvidas:
- Estado atual em 1 frase:

## 7) Resposta final ao operador
- Resultado desta fatia: o que mudou e onde.
- Validação: comandos/tools e status curto.
- Snapshot de gates determinísticos relevantes: decisão, reason code, autorização, blockers e próximo passo seguro.
- Se gate determinístico bloquear: parar em `ask-operator`, fazer uma pergunta objetiva e não sugerir dispatch/auto-continuação implícita.
- Contexto subjetivo só registra evidência e direção; autorização real exige gate/tool/runtime quando houver risco.
- Decisão necessária: uma pergunta objetiva ou `nenhuma`.
- Próximo passo seguro: uma ação concreta, local-safe e reversível.
- Bloqueios/limites: o que ainda não está autorizado (ex.: dispatch, protected scope, provider/settings, CI/remote).
