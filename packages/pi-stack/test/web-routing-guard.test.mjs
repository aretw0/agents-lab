/**
 * Tests for deterministic web-routing classifier and bash blocker (guardrails-core).
 *
 * Run: node --test packages/pi-stack/test/web-routing-guard.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const INTERACTIVE_TERMS = [
  "open", "abrir", "abra", "navigate", "navegar", "navegue", "click", "clicar", "clique", "fill", "preencher", "preencha",
  "login", "log in", "submit", "enviar", "envie", "form", "formulário", "formulario", "tab", "button", "botão", "botao",
];

const SENSITIVE_DOMAINS = ["npmjs.com"];
const SENSITIVE_HINTS = ["cloudflare", "bot block", "bloqueio", "captcha", "challenge"];

const DISALLOWED_BASH_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /python(?:3)?\b[\s\S]*?requests/i,
  /r\.jina\.ai/i,
  /\bnpm\s+view\b/i,
  /registry\.npmjs\.org/i,
];

const CDP_SCRIPT_HINT = /web-browser[\/\\]scripts|scripts[\/\\](start|nav|eval|pick|screenshot|dismiss-cookies|watch|logs-tail|net-summary)\.js/i;

function uniq(values) {
  return [...new Set(values)];
}

function extractDomains(text) {
  const lower = text.toLowerCase();
  const domains = [];

  const urlMatches = lower.match(/https?:\/\/[^\s)"']+/g) ?? [];
  for (const raw of urlMatches) {
    try {
      const host = new URL(raw).hostname.replace(/^www\./, "");
      if (host) domains.push(host);
    } catch {
      // ignore malformed URLs
    }
  }

  const domainLikeMatches = lower.match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/g) ?? [];
  for (const d of domainLikeMatches) domains.push(d.replace(/^www\./, ""));

  return uniq(domains);
}

function hasInteractiveIntent(text) {
  const lower = text.toLowerCase();
  return INTERACTIVE_TERMS.some((term) => lower.includes(term));
}

function classifyRouting(prompt) {
  const lower = prompt.toLowerCase();
  const domains = extractDomains(lower);
  const interactive = hasInteractiveIntent(lower);
  const sensitiveDomain = domains.some((d) => SENSITIVE_DOMAINS.some((sd) => d === sd || d.endsWith(`.${sd}`)));
  const sensitiveHint = SENSITIVE_HINTS.some((hint) => lower.includes(hint));

  return {
    interactive,
    sensitiveDomain,
    sensitiveHint,
    strictMode: interactive && (sensitiveDomain || sensitiveHint),
    domains,
  };
}

function isDisallowedBash(command) {
  const lower = command.toLowerCase();
  if (CDP_SCRIPT_HINT.test(lower)) return false;
  return DISALLOWED_BASH_PATTERNS.some((p) => p.test(lower));
}

describe("classifyRouting", () => {
  it("activates strict mode for CF1 interactive npmjs scenario", () => {
    const prompt = "Abra https://www.npmjs.com/package/vitest e extraia 5 dependências da seção Dependencies usando navegação de browser.";
    const d = classifyRouting(prompt);
    assert.equal(d.interactive, true);
    assert.equal(d.sensitiveDomain, true);
    assert.equal(d.strictMode, true);
  });

  it("activates strict mode for cloudflare hint even without explicit URL", () => {
    const prompt = "Abra o site e faça login; estou levando block da Cloudflare";
    const d = classifyRouting(prompt);
    assert.equal(d.interactive, true);
    assert.equal(d.sensitiveHint, true);
    assert.equal(d.strictMode, true);
  });

  it("does not activate strict mode for non-interactive extraction", () => {
    const prompt = "Liste os principais links da documentação do TypeScript e resuma o conteúdo";
    const d = classifyRouting(prompt);
    assert.equal(d.interactive, false);
    assert.equal(d.strictMode, false);
  });

  it("does not activate strict mode for interactive prompt in non-sensitive domain", () => {
    const prompt = "Abra https://www.typescriptlang.org e navegue até tsconfig";
    const d = classifyRouting(prompt);
    assert.equal(d.interactive, true);
    assert.equal(d.sensitiveDomain, false);
    assert.equal(d.strictMode, false);
  });
});

describe("isDisallowedBash", () => {
  it("blocks r.jina.ai and curl fallback commands", () => {
    assert.equal(isDisallowedBash("curl -L \"https://r.jina.ai/http://https://www.npmjs.com/package/typescript\""), true);
    assert.equal(isDisallowedBash("curl -I https://www.npmjs.com/package/typescript"), true);
  });

  it("blocks python requests scraping", () => {
    const cmd = "python - <<'PY'\nimport requests\nrequests.get('https://www.npmjs.com/package/typescript')\nPY";
    assert.equal(isDisallowedBash(cmd), true);
  });

  it("allows CDP browser script commands", () => {
    assert.equal(isDisallowedBash("node ./packages/web-skills/skills/web-browser/scripts/start.js"), false);
    assert.equal(isDisallowedBash("node ./packages/web-skills/skills/web-browser/scripts/nav.js https://www.npmjs.com/package/typescript"), false);
    assert.equal(isDisallowedBash("node ./packages/web-skills/skills/web-browser/scripts/eval.js 'document.title'"), false);
  });
});
