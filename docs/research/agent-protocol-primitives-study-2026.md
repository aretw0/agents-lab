# Agent protocol primitives study 2026 (MCP, SLIM, Identity/Discovery)

Referência: `TASK-BUD-626`.
Objetivo: mapear interoperabilidade multiagente sem quebrar soberania local-first.

## 1) Contratos e trade-offs

## MCP

Contrato principal:
- tool/schema contract explícito;
- integração orientada a capability surface;
- bom encaixe para ecossistema com múltiplas ferramentas.

Trade-offs:
- aumenta superfície de integração (versões, adapters, auth boundary);
- exige governança forte para evitar tool sprawl e acoplamento indireto;
- risco de drift de contrato entre providers/implementações.

## SLIM

Contrato principal:
- protocolo mais enxuto para coordenação/mensageria;
- menor overhead conceitual para fluxos simples;
- potencial bom para caminhos de baixa latência e baixa complexidade.

Trade-offs:
- menor padronização/ecossistema disponível (neste momento);
- pode exigir extensões custom que viram dívida;
- risco de incompatibilidade com cadeias de toolings maiores.

## Agent Identity & Discovery

Contrato principal:
- identidade verificável do agente/instância;
- discovery explícito (quem é quem, onde roda, quais capacidades expõe);
- base para confiança e roteamento auditável entre agentes.

Trade-offs:
- custo de operação/PKI/credenciais e rotação segura;
- risco de spoofing se a verificação for parcial;
- sem política local-first clara, pode induzir auto-dispatch indevido.

## 2) Posição de adoção (observe | experiment | integrate-later)

| Primitive | Posição | Motivo curto |
|---|---|---|
| MCP | experiment | Alta utilidade prática para capability contracts, mas com gate de governança rígido. |
| SLIM | observe | Potencial interessante, porém maturidade/ecossistema ainda insuficientes para investimento imediato. |
| Agent Identity & Discovery | experiment | Fundamental para delegação auditável, desde que autenticação verificável e fail-closed sejam obrigatórias. |

Condição transversal: **integrate-later** só após evidência repetível em experimentos locais bounded.

## 3) Restrições obrigatórias de soberania local

1. **No auto-dispatch protegido**
   - nenhuma primitive pode autorizar execução automática em escopos protegidos (`.github`, publish, settings globais, remotos) sem decisão humana explícita.

2. **Autenticação verificável**
   - identidade de agente/serviço deve ser verificável (não apenas declarativa);
   - falha de verificação => bloqueio/fail-closed, nunca degrade silencioso.

3. **Auditabilidade de handoff**
   - toda decisão de roteamento/delegação deve deixar trilha em board/handoff (quem decidiu, por quê, evidência, rollback).

## 4) Sequência recomendada (anti-forcing)

1. manter MCP/Identity em **experiment report-only** (escopo pequeno, reversível);
2. manter SLIM em **observe** até sinais de maturidade suficientes;
3. só abrir frente de integração estrutural após:
   - ganho mensurável de throughput com governança estável,
   - blocked-rate controlado,
   - ausência de regressão de soberania local.

## 5) Conclusão

É possível acelerar e delegar mais sem perder controle, mas o caminho sustentável exige disciplina:
- primeiro contratos explícitos,
- depois identidade verificável,
- sempre com no auto-dispatch protegido e handoff auditável.
