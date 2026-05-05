# Pipeline editorial agents-lab

## Objetivo

Gerar notas internas, release notes e posts futuros sobre o ecossistema agents-lab sem misturar indevidamente:

- mudanças da **nossa stack** (`agents-lab`, `@aretw0/pi-stack`, skills, scripts, docs, governança);
- mudanças do **Pi upstream**;
- mudanças de **dependências/terceiros**;
- aprendizado/curadoria ainda não assimilado.

O pipeline depende da evidência definida em [`dependency-upstream-governance.md`](./dependency-upstream-governance.md). Sem atribuição verificável, o item editorial fica em `hold`.

## Categorias editoriais

| Categoria | Use quando | Evidência mínima |
|---|---|---|
| `nossa-stack` | O commit/artefato foi produzido neste repo | commit local, task/verificação, arquivos alterados |
| `upstream-pi` | O comportamento vem do Pi/TUI/base CLI | versão instalada + changelog/release/commit ou investigação bounded |
| `deps-terceiros` | O item vem de extensão/skill/lib externa | versão instalada + changelog/release/commit ou package evidence |
| `curadoria` | É aprendizado, inspiração ou comparação ainda não incorporada | intake/research doc + decisão `defer|promote|skip` |
| `misto` | Combina mudança local com upstream/deps | relatório de atribuição separando cada parte |

## Regras de publicação

1. Não afirmar mudança upstream sem evidência verificável.
2. Não transformar rumor, monitor advisory ou observação isolada em release note.
3. Todo item publicado precisa apontar para pelo menos uma fonte: commit, task, verificação, changelog, release note, pacote/version evidence ou research doc.
4. Mudanças `misto` devem separar “o que fizemos” de “o que mudou fora”.
5. Itens em `hold` podem entrar em backlog editorial, mas não em post público como fato.
6. Não publicar detalhes sensíveis de workspace, credenciais, prompts privados ou incidentes de usuário.
7. Atualização de dependência continua protegida: o pipeline editorial descreve evidência, não autoriza update.

## Fluxo local-safe

1. **Coletar candidatos** — commits recentes, tasks concluídas, verificações, docs de pesquisa e relatórios de atribuição.
2. **Classificar origem** — `nossa-stack|upstream-pi|deps-terceiros|curadoria|misto`.
3. **Anexar evidência** — preencher fonte mínima por item.
4. **Decidir status editorial** — `publishable|hold|reject`.
5. **Escrever rascunho** — separar seções por categoria.
6. **Validar** — marker check para categorias, fontes e regra anti-assunção upstream.

## Template de release note/post interno

```md
# Agents-lab update — <data ou versão>

## Resumo
- foco: <tema da janela>
- público: internal|public-draft|public
- status: draft|review|published
- evidence_policy: nenhum item sem fonte verificável

## Nossa stack
| Item | Impacto | Evidência | Validação | Rollback |
|---|---|---|---|---|
| <mudança local> | <por que importa> | task:<id>, ver:<id>, commit:<sha>, files:<paths> | <teste/inspeção> | <reverter commit/config> |

## Pi upstream
| Item | Impacto | Evidência upstream | Estado local | Decisão |
|---|---|---|---|---|
| <mudança upstream> | <por que importa> | <release/changelog/commit/version evidence> | <versão instalada/canário> | assimilate|hold|reject |

## Dependências e terceiros
| Item | Pacote/versão | Evidência | Risco | Decisão |
|---|---|---|---|---|
| <mudança dep> | <pkg@version> | <lockfile/changelog/release> | low|medium|high | assimilate|hold|reject |

## Curadoria e aprendizado
| Ideia | Fonte | Status | Próximo passo |
|---|---|---|---|
| <ideia> | <research/intake> | defer|promote|skip | <canário/backlog/nenhum> |

## Itens em hold
- <item>: falta <evidência>; não publicar como fato upstream/local.

## Notas de segurança
- protected_scope: yes|no + motivo
- dados sensíveis removidos: yes|no
- dependências atualizadas nesta publicação: no por padrão
```

## Checklist pré-publicação

- [ ] Cada item tem categoria editorial.
- [ ] Cada item tem evidência verificável.
- [ ] Itens upstream/deps citam versão/fonte ou ficam em `hold`.
- [ ] Itens mistos separam parte local e parte externa.
- [ ] Nenhuma atualização de dependência foi feita pelo pipeline editorial.
- [ ] Nenhum segredo, caminho privado sensível ou dado de usuário foi incluído.
- [ ] O rascunho deixa claro se é interno, draft público ou publicado.

## Primeiro uso recomendado

Para uma primeira nota interna, usar uma janela curta de commits locais e registrar apenas itens `nossa-stack` com verificação já passada. Em seguida, adicionar seção `upstream/deps` somente se houver relatório de atribuição completo; caso contrário, listar em `Itens em hold`.
