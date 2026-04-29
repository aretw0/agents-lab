export const INTERACTIVE_TERMS = [
  "open",
  "abrir",
  "abra",
  "navigate",
  "navegar",
  "navegue",
  "click",
  "clicar",
  "clique",
  "fill",
  "preencher",
  "preencha",
  "login",
  "log in",
  "submit",
  "enviar",
  "envie",
  "form",
  "formulário",
  "formulario",
  "tab",
  "button",
  "botão",
  "botao",
];

export const SENSITIVE_DOMAINS = ["npmjs.com"];

export const SENSITIVE_HINTS = ["cloudflare", "bot block", "bloqueio", "captcha", "challenge"];

export const DISALLOWED_BASH_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /python(?:3)?\b[\s\S]*?requests/i,
  /r\.jina\.ai/i,
  /\bnpm\s+view\b/i,
  /registry\.npmjs\.org/i,
];

export const CDP_SCRIPT_HINT =
  /web-browser[\/\\]scripts|scripts[\/\\](start|nav|eval|pick|screenshot|dismiss-cookies|watch|logs-tail|net-summary)\.js/i;
