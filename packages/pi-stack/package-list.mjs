/**
 * Managed packages — all pi packages that pi-stack installs/removes.
 *
 * Split into:
 *  - FIRST_PARTY: published from this monorepo (@aretw0/*)
 *  - THIRD_PARTY: external dependencies (oh-pi, mitsupi, etc.)
 *  - PACKAGES: full list (FIRST_PARTY + THIRD_PARTY)
 */

/** @aretw0 first-party packages from this monorepo */
export const FIRST_PARTY = [
  "@aretw0/pi-skills",
  "@aretw0/git-skills",
  "@aretw0/web-skills",
  "@aretw0/lab-skills",
];

/** Third-party packages curated in the stack */
export const THIRD_PARTY = [
  "mitsupi",
  "pi-lens",
  "pi-web-access",
  "@davidorex/pi-project-workflows",
  "@ifi/oh-pi-skills",
  "@ifi/oh-pi-themes",
  "@ifi/oh-pi-prompts",
  "@ifi/oh-pi-extensions",
  "@ifi/oh-pi-ant-colony",
  "@ifi/pi-extension-subagents",
  "@ifi/pi-plan",
  "@ifi/pi-spec",
  "@ifi/pi-web-remote",
];

/** All managed packages */
export const PACKAGES = [...FIRST_PARTY, ...THIRD_PARTY];
