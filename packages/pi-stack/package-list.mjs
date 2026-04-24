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
  "@aretw0/pi-stack",   // meta-package: environment-doctor, monitor-provider-patch, guardrails-core
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

/**
 * Official minimal baseline for distribution.
 * Keeps only canonical curated surfaces (strict-curated profile).
 */
export const STRICT_CURATED = [
  ...FIRST_PARTY,
  "@davidorex/pi-project-workflows",
];

/**
 * Runtime/capability extras that remain opt-in outside strict baseline.
 */
export const RUNTIME_CAPABILITY_EXTRAS = [
  "@ifi/oh-pi-extensions",
  "@ifi/oh-pi-ant-colony",
  "@ifi/pi-web-remote",
];

/**
 * Compatibility alias: curated-default now maps to strict-curated.
 * Kept to avoid breaking existing scripts and docs.
 */
export const CURATED_DEFAULT = STRICT_CURATED;

/**
 * Strict baseline + curated runtime extras (still smaller than stack-full).
 */
export const CURATED_RUNTIME = [...STRICT_CURATED, ...RUNTIME_CAPABILITY_EXTRAS];

/** All managed packages */
export const PACKAGES = [...FIRST_PARTY, ...THIRD_PARTY];
