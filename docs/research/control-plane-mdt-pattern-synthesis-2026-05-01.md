# Síntese de padrões MDT para o control-plane (local-safe)

Data: 2026-05-01  
Status: proposta operacional (report-only) baseada em artefatos locais versionados.

## Evidência local utilizada

- `docs/research/agent-factory-vs-squeez-mdt-2026-04-21.md`
- `docs/guides/control-plane-operating-doctrine.md`
- `docs/guides/project-canonical-pipeline.md`

> Escopo desta síntese: transformar inspiração `mdt` em regras acionáveis **sem** CI/remote/offload e sem lock-in em tooling externo.

## Padrão MDT-1 — Single-source com contrato mínimo de bloco

**Regra:** manter seções repetidas (README/guias/skills) com âncoras estáveis e ownership explícito por bloco.  
**Quando usar:** quando a mesma política aparece em 2+ superfícies e já existe drift recorrente.  
**Risco:** sobre-templatear texto vivo e matar contexto local da superfície.  
**Aplicação local-safe:** começar com âncoras/markers auditáveis + testes smoke de presença; sem auto-update em massa.

## Padrão MDT-2 — Check-first, update depois (com prova)

**Regra:** toda trilha de sincronização documental começa em modo `check` (detecção), só depois vai para `update`.  
**Quando usar:** início de rollout ou quando ainda não há histórico de baixo churn.  
**Risco:** pular para update cedo e gerar ruído de diffs sem ganho de contrato.  
**Aplicação local-safe:** exigir evidência focal (marker-check/teste smoke) antes de qualquer expansão de escopo.

## Padrão MDT-3 — Drift budget por fatia

**Regra:** limitar cada fatia a um raio curto (1 tema, poucos arquivos) e medir delta de consistência.  
**Quando usar:** docs extensas com múltiplos guias e risco de efeito cascata.  
**Risco:** mudar muitas páginas em lote e perder auditabilidade da intenção.  
**Aplicação local-safe:** batch pequeno + checkpoint obrigatório + rollback simples (`git revert commit`).

## Padrão MDT-4 — Dicionário canônico de termos operacionais

**Regra:** termos críticos de operação (ex.: `recommendationCode`, `no-eligible-tasks`, stop condition) devem ter definição canônica e teste de presença cruzada.  
**Quando usar:** superfícies diferentes começam a divergir no vocabulário de decisão.  
**Risco:** inconsistência semântica entre docs e payloads de tool surface.  
**Aplicação local-safe:** manter pares doctrine/glossary sincronizados com regressão smoke (fail-closed).

## Padrão MDT-5 — Promoção gradual para governança mais forte

**Regra:** só promover para gates mais rígidos (ex.: CI) após evidência local de redução de drift com baixo churn.  
**Quando usar:** quando o check local já roda limpo por múltiplas fatias e revisão humana confirma utilidade.  
**Risco:** institucionalizar gate antes da maturidade e bloquear fluxo sem necessidade.  
**Aplicação local-safe:** manter report-only como default; registrar pacote de maturidade antes de qualquer proposta protegida.

## Regras operacionais acionáveis (extraídas)

1. Toda nova regra documental deve nascer com: `regra + quando usar + risco + validação focal + rollback`.
2. Se a regra tocar linguagem operacional, adicionar evidência de consistência em doctrine/glossary.
3. Não introduzir automação de sync em lote sem prova local (2-3 fatias limpas, sem ruído de revisão).
4. Se surgir `no-eligible-tasks`, parar e semear backlog local-safe em vez de forçar escopo protegido.

## Resultado esperado para o control-plane

- Menos drift silencioso entre guias-chave.
- Menos retrabalho manual em textos repetidos.
- Contrato semântico mais estável entre docs e tool surfaces.
- Evolução incremental sem quebrar o princípio local-first.
