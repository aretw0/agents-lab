---
name: web-browser
description: "Interact with web pages via browser automation: navigate, click, fill forms, screenshot, and evaluate JavaScript. Uses Chrome/Chromium remote debugging (CDP)."
---

# Web Browser Skill

Browser automation via Chrome DevTools Protocol (CDP). All scripts live in `./scripts/` relative to this skill.

## When to Prefer This Skill

Use `web-browser` for **interactive** web tasks:
- open/navigate pages and tabs
- click buttons/links
- fill forms and login flows
- inspect dynamic UI state rendered in-browser

For non-interactive tasks (searching links, extracting page text, fetching docs), prefer `web_search` / `fetch_content` instead.

## Scoped Hard Trigger Policy

Enforce **browser-first (hard-by-scope)** when BOTH conditions are present:

1. Prompt has interactive intent (`open`, `navigate`, `click`, `fill`, `login`, `submit`, `tab`, `form`, `button`), and
2. Target is a sensitive/challenge-prone domain (e.g. `npmjs.com`) or the user reports Cloudflare/bot blocking.

When this trigger fires:
- Start with CDP flow (`start.js` → `nav.js` → interaction/eval scripts).
- Do **not** start from `curl`/`wget`/`python requests`/`r.jina.ai` or generic shell scraping.
- Only fallback after explicit CDP failure evidence (at least 2 failed attempts), and report the fallback reason.

> **Dependency:** `@aretw0/web-skills` declares `ws` at the package root. Published installs should not require per-skill setup. When running from this repository source, run `pnpm install` at the repository root before using the scripts.

## Start Chrome

```bash
node ./scripts/start.js              # Fresh profile
node ./scripts/start.js --profile    # Copy your real profile (cookies, logins)
```

Starts Chrome on `:9222` with remote debugging enabled.

If Chrome is in a non-standard location:
```bash
BROWSER_BIN=/path/to/chrome node ./scripts/start.js
```

## Navigate

```bash
node ./scripts/nav.js https://example.com           # Current tab
node ./scripts/nav.js https://example.com --new     # New tab
```

## Evaluate JavaScript

```bash
node ./scripts/eval.js 'document.title'
node ./scripts/eval.js 'document.querySelectorAll("a").length'
node ./scripts/eval.js 'JSON.stringify(
  Array.from(document.querySelectorAll("a"))
    .map(a => ({ text: a.textContent.trim(), href: a.href }))
    .filter(l => l.href.startsWith("https://"))
)'
```

Runs in the active tab's async context. Use single quotes to avoid shell escaping issues.

## Screenshot

```bash
node ./scripts/screenshot.js
```

Screenshots the current viewport and returns the temp file path.

## Pick Elements

```bash
node ./scripts/pick.js "Click the submit button"
```

Interactive element picker. Click to select, Cmd/Ctrl+Click for multi-select, Enter to finish.

## Dismiss Cookie Dialogs

```bash
node ./scripts/dismiss-cookies.js          # Accept cookies
node ./scripts/dismiss-cookies.js --reject # Reject where possible
```

Run after navigation:
```bash
node ./scripts/nav.js https://example.com && node ./scripts/dismiss-cookies.js
```

## Background Logging (Console + Errors + Network)

Started automatically by `start.js`. Writes JSONL to:
```
~/.cache/agent-web/logs/YYYY-MM-DD/<targetId>.jsonl
```

Manually:
```bash
node ./scripts/watch.js               # Start
node ./scripts/logs-tail.js           # Dump current log and exit
node ./scripts/logs-tail.js --follow  # Follow
node ./scripts/net-summary.js         # Summarize network responses
```
