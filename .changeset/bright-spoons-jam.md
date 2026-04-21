---
"@aretw0/pi-stack": patch
---

Release candidate de governança multi-provider (sem publish automático), com foco em previsibilidade operacional e economia de contexto:

- consolida fechamento do ciclo de budget global + roteamento advisory com evidência determinística no board canônico;
- fortalece benchmark canônico de economia de contexto com parsing resiliente em modo JSON (tolerante a ruído de terminal/OSC);
- formaliza lanes operacionais para OpenAI (lean/governed/swarm) para reduzir custo/latência sem perder governança quando necessário.

Riscos e limites conhecidos (mantidos explícitos):

- overhead de contexto do stack-default continua alto vs modo lean e requer escolha deliberada de lane por sessão;
- ruído de extensões que escrevem notificações em stdout pode afetar instrumentação, mitigado no benchmark por parser robusto;
- governança de BLOCK depende de provider budgets configurados corretamente no `.pi/settings.json`.
