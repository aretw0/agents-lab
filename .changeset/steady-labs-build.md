---
"@aretw0/pi-stack": minor
"@aretw0/git-skills": minor
"@aretw0/web-skills": minor
"@aretw0/pi-skills": minor
"@aretw0/lab-skills": minor
---

Prepare the 0.8 release line around a stricter local-first factory baseline:

- migrate the workspace to pnpm with lockfile-based installs, minimum release age policy, CI cache trust scoping, and publish provenance kept on the npm publish boundary;
- add shared GitHub Actions setup contracts, pinned third-party action checks, runtime budgets, local parity gates, release package dry-run smoke, and release readiness reporting;
- add the minimal GitHub Pages site and docs contracts that keep public navigation, package docs, Mermaid rendering, and site base paths testable from host or devcontainer;
- harden the devcontainer for daily operator work with the `lab` entrypoint, persisted assistant caches, GitHub CLI, pnpm global bin, terminal/encoding setup, and docs port forwarding;
- keep Pi runtime startup lean by moving optional surfaces cold, measuring dev pressure, tightening watchdog defaults, and preserving the control-plane profile as the default daily lane;
- strengthen engine portability and package boundaries so core primitives stay adapter-ready for future engines while Pi-specific work remains in surfaces/adapters;
- mature worker/arena primitives with report-only manifests, scorecards, fan-in validation, exact-confirmed artifact writing, and promoted worker packets without enabling unbounded dispatch;
- distribute generic maintenance and governance guides while keeping lab-only operational material out of published package docs.
