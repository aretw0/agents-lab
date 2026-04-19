---
"@aretw0/pi-stack": minor
"@aretw0/git-skills": minor
"@aretw0/web-skills": minor
"@aretw0/pi-skills": minor
"@aretw0/lab-skills": minor
---

Release de consolidação do control-plane/TUI com foco em economia de contexto, observabilidade e governança operacional:

- adiciona painel toggleável de colônias no footer (`/cpanel off|on|auto|status|snapshot`) com resumo + overflow controlado;
- adiciona superfície compacta para monitores (`monitors_compact_status` + `/mstatus`) e status curto no footer;
- compacta outputs grandes de ferramentas first-party (`colony-pilot`, `web-session-gateway`, `quota-visibility`) mantendo payload completo em `details`;
- reforça hardening de installer para conflitos conhecidos (`mitsupi/uv.ts` vs `bg-process`) com merge idempotente de filtros;
- corrige path dos templates dos classifiers de monitor para eliminar warnings de `Instructions are required`.
