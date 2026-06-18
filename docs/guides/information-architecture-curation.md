---
title: Information Architecture Curation
description: Curation rules for agents-lab site, repository docs and packaged documentation surfaces.
---

# Information Architecture Curation

Status: operating guide for docs discoverability and publication scope.

This guide defines how agents-lab decides where documentation belongs. The goal
is not to keep fewer documents at any cost. The goal is to make the right thing
discoverable by the right reader: operator, maintainer, interested user, package
consumer or future agent.

## Surfaces

| Surface | Audience | Purpose | Curation posture |
|---|---|---|---|
| Public site homepage | new readers | explain what agents-lab is and where to start | small and role-oriented |
| `docs/start-here.md` | all readers | route by profile | curated index, not full inventory |
| `docs/guides/README.md` | operators/maintainers | discover operational guides | grouped by use case |
| `docs/primitives/README.md` | agents/maintainers | discover reusable contracts | catalog, not release notes |
| `docs/research/` | maintainers/agents | preserve dated evidence | not canonical until promoted |
| package docs copies | package consumers/skills | make shipped skills usable offline | only docs needed after install |
| archive | maintainers | preserve history | excluded from current operations |

## Site Publication Rule

Being under `docs/` means the file may be published by the static site. That does
not mean it should become a public entrypoint.

A document deserves a public navigation link when it satisfies at least one of:

1. It is an entrypoint for a reader profile.
2. It defines a current operational contract.
3. It is selected evidence for an active release or architecture decision.
4. It is a reusable primitive that agents or maintainers should discover.

Otherwise it can stay published but unfeatured, or move to research/archive when
it is historical evidence.

## Package Documentation Rule

Package docs should answer: "can this skill, extension or packaged workflow be
used correctly after npm install without reading the monorepo?"

Ship a guide with a package only when it is directly needed for:

- installed commands, tools, skills or prompts;
- user-facing configuration;
- troubleshooting packaged behavior;
- safety boundaries that affect package consumers;
- reusable workflows referenced by shipped skills.

Do not ship a guide with packages only because it is important to the monorepo,
release process or internal planning.

The source of truth is `scripts/sync-package-docs.mjs`. If a packaged skill links
to `docs/guides/<name>.md`, either the guide must be listed for that package or
the link should point to the public site/repository instead.

## Research Promotion Rule

Research is allowed to be messy, dated and specific. Promotion is a separate act.

Promote research to a guide, primitive or architecture doc only when:

1. It describes a current repeated workflow or invariant.
2. It has a clear audience.
3. It contains a stable decision, packet, command, checklist or rule.
4. It states non-goals and stale boundaries.
5. It passes discourse review for canonical language.

If those are not true, keep it in research and link it only as selected evidence
when needed.

## Pruning Rule

Pruning means reducing operational load. It does not always mean deleting.

| Situation | Action |
|---|---|
| Duplicate guide with same audience | merge or redirect from the weaker entry |
| Research now represented by a primitive | keep research as evidence; link primitive as canonical |
| Guide only needed by package users | keep source in `docs/guides`, ship generated copy through package docs |
| Guide only needed by monorepo maintainers | keep in guides but avoid homepage/start-here prominence |
| Historical handoff/checkpoint | move to archive or leave in research unfeatured |
| Raw logs or large local artifacts | keep ignored/local; summarize as research data or CI artifact |
| Loaded or chat-specific language | rewrite or let `repo:discourse:audit` surface it |

## Unfeatured Retention Rule

Some documents remain published but should not be treated as primary navigation.
This is valid when a document is a draft spec, an incident note, an old charter,
a planning inventory or a provider-specific playbook that would distract from
the current operator path.

`docs:ia:audit` keeps an explicit retained-unfeatured list for those cases. Add
a file to that list only with a reason that fits this guide; otherwise either
promote it to the relevant index or move it to research/archive.

## Agent Discoverability

Agents need stable entrypoints more than exhaustive menus.

Preferred agent path:

1. `docs/start-here.md` for reader/profile routing.
2. `docs/guides/README.md` for operational guide discovery.
3. `docs/primitives/README.md` for reusable contracts.
4. `docs/site-map.md` for publication boundaries.
5. Package docs indexes for installed-skill context.
6. `docs/research/` only when selected evidence or a task points there.

A future search or retrieval layer should preserve this order instead of ranking
large research files above current contracts just because they contain more words.

## Checks

Use these checks as different lenses:

```bash
pnpm run docs:ia:audit
pnpm run docs:site:smoke
pnpm run docs:package:check
pnpm run repo:discourse:audit
pnpm run repo:bloat:audit
pnpm run test:pi-stack:user-surface
```

What they cover:

- `docs:ia:audit`: entrypoint presence, selected-evidence routing and index coverage for guides/primitives/research.
- `docs:site:smoke`: the site builds and required indexes exist.
- `docs:package:check`: package doc copies match their source and references.
- `repo:discourse:audit`: canonical language does not overclaim or carry stale terms.
- `repo:bloat:audit`: raw/log/generated artifacts do not become tracked weight.
- `test:pi-stack:user-surface`: root scripts are classified as distributed wrappers or repo-internal.

What they do not cover yet:

- whether every guide deserves its current prominence;
- whether search results prefer canonical docs over stale research;
- whether package consumers can find all relevant docs from inside the installed package.

Those are candidates for future information architecture scorecards.
