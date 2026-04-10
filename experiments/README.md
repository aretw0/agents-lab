# Experimentos — agents-lab

Este diretório contém experimentos práticos e provas de conceito do laboratório.

## O que é um Experimento?

Um experimento é qualquer código, configuração ou prova de conceito criada para:

- Testar hipóteses sobre design de agentes
- Avaliar uma engine ou biblioteca específica
- Prototipar uma primitiva antes de formalizá-la
- Reproduzir exemplos de material de referência

## Estrutura de um Experimento

Cada experimento vive em seu próprio subdiretório:

```text
experiments/
├── YYYYMM-nome-descritivo/
│   ├── README.md          # Contexto, objetivos e conclusões
│   ├── [código do experimento]
│   └── .env.example       # Variáveis de ambiente necessárias (nunca commitar .env)
```

### Formato do README de Experimento

```md
# Nome do Experimento

**Data:** YYYY-MM-DD  
**Engine:** Pi / outro  
**Status:** Em andamento / Concluído / Abandonado

## Objetivo
O que este experimento busca descobrir ou validar.

## Configuração
Como rodar este experimento localmente.

## Resultados
O que foi descoberto.

## Conclusões
Implicações para o laboratório — primitivas extraíveis, padrões identificados, etc.
```

## Convenções

- **Nomenclatura:** `YYYYMM-nome-descritivo` (ex.: `202504-pi-tools-basics`)
- **Isolamento:** cada experimento deve ser autocontido
- **Documentação:** todo experimento precisa de um `README.md`
- **Segredos:** nunca commitar chaves de API — use `.env.example` como template
- **Dependências:** liste no `README.md` o que precisa ser instalado

## Ciclo de Vida

```text
Ideia → Experimento → Revisão → [Primitiva / Documentação / Arquivado]
```

Experimentos bem-sucedidos podem ser **promovidos** a primitivas reutilizáveis no diretório [`primitives/`](../primitives/).

## Experimentos Ativos

Primeiros experimentos já começaram a surgir a partir da validação prática do Pi no ambiente real do laboratório.

| Experimento | Engine | Status | Data |
|-------------|--------|--------|------|
| [202604-pi-first-validation](./202604-pi-first-validation/README.md) | Pi | Concluído | 2026-04-09 |
