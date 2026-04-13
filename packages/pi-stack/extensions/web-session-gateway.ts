/**
 * web-session-gateway — First-party local web observability for pi sessions.
 *
 * Philosophy:
 * - deterministic access URL by mode (local/lan/public)
 * - no dependency on hosted third-party UI domain
 * - minimal HTTP surface for session/colony visibility
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseColonySignal, parseCommandInput } from "./colony-pilot";

type GatewayMode = "local" | "lan" | "public";

interface GatewayConfig {
  mode: GatewayMode;
  port: number;
  advertisedHost?: string;
}

interface WebState {
  monitorMode: "on" | "off" | "unknown";
  sessionFile?: string;
  colonies: Array<{ id: string; phase: string; updatedAt: number }>;
  recentSignals: Array<{ at: number; text: string }>;
  recentMessages: Array<{ at: number; role: string; text: string }>;
}

interface GatewayRuntime {
  running: boolean;
  startedAt?: number;
  bindHost: string;
  port: number;
  token: string;
  server?: ReturnType<typeof createServer>;
}

const DEFAULT_CONFIG: GatewayConfig = {
  mode: "local",
  port: 3100,
};

const SIGNAL_LIMIT = 40;
const MESSAGE_LIMIT = 80;

export function resolveGatewayMode(input?: string): GatewayMode {
  if (input === "lan" || input === "public" || input === "local") return input;
  return "local";
}

export function getBindHost(mode: GatewayMode): string {
  return mode === "local" ? "127.0.0.1" : "0.0.0.0";
}

export function buildAccessHost(mode: GatewayMode, bindHost: string, advertisedHost?: string): string {
  if (mode === "local") return "127.0.0.1";
  if (advertisedHost && advertisedHost.trim()) return advertisedHost.trim();
  if (mode === "lan") return bindHost === "0.0.0.0" ? "localhost" : bindHost;
  // public mode without explicit host still returns localhost to avoid lying.
  return "localhost";
}

export function buildGatewayAccessUrl(input: {
  mode: GatewayMode;
  bindHost: string;
  advertisedHost?: string;
  port: number;
  token: string;
}): string {
  const host = buildAccessHost(input.mode, input.bindHost, input.advertisedHost);
  return `http://${host}:${input.port}/?t=${input.token}`;
}

function readSettingsConfig(cwd: string): Partial<GatewayConfig> {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return {};
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.extensions?.webSessionGateway ?? {};
    return {
      mode: resolveGatewayMode(cfg.mode),
      port: typeof cfg.port === "number" ? cfg.port : undefined,
      advertisedHost: typeof cfg.advertisedHost === "string" ? cfg.advertisedHost : undefined,
    };
  } catch {
    return {};
  }
}

function unauthorized(res: ServerResponse) {
  res.statusCode = 401;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "unauthorized" }));
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://localhost");
}

function requireToken(req: IncomingMessage, token: string): boolean {
  const u = parseUrl(req);
  const qt = u.searchParams.get("t");
  if (qt && qt === token) return true;

  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7) === token;
  }

  return false;
}

export function isPromptDelivery(value: unknown): value is "followUp" | "steer" {
  return value === "followUp" || value === "steer";
}

export function parsePromptPayload(raw: unknown):
  | { ok: true; message: string; deliverAs: "followUp" | "steer" }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "payload must be an object" };
  }

  const payload = raw as { message?: unknown; deliverAs?: unknown };
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    return { ok: false, error: "message is required" };
  }

  const deliverAs = isPromptDelivery(payload.deliverAs) ? payload.deliverAs : "followUp";
  return { ok: true, message, deliverAs };
}

function renderHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>pi session gateway</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif;background:#0b1020;color:#e6edf3;margin:0;padding:24px}
    .card{background:#121a2b;border:1px solid #23314f;border-radius:12px;padding:16px;max-width:980px}
    h1{margin:0 0 12px 0;font-size:20px}
    pre{background:#0b1324;border:1px solid #223355;border-radius:8px;padding:12px;overflow:auto;max-height:70vh}
    .muted{color:#9fb0cd}
  </style>
</head>
<body>
  <div class="card">
    <h1>pi session gateway</h1>
    <div class="muted">Atualização automática a cada 2s</div>
    <pre id="out">loading...</pre>
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
      <textarea id="prompt" placeholder="Enviar mensagem para a sessão..." style="width:100%;min-height:80px;background:#0b1324;color:#e6edf3;border:1px solid #223355;border-radius:8px;padding:8px"></textarea>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="delivery" style="background:#0b1324;color:#e6edf3;border:1px solid #223355;border-radius:8px;padding:6px">
          <option value="followUp">followUp (seguro)</option>
          <option value="steer">steer (enquanto streama)</option>
        </select>
        <button id="send" style="background:#1f6feb;color:white;border:none;border-radius:8px;padding:8px 12px;cursor:pointer">Enviar</button>
        <span id="sendStatus" class="muted"></span>
      </div>
    </div>
  </div>
<script>
  const out=document.getElementById('out');
  const token=new URLSearchParams(location.search).get('t')||'';
  async function tick(){
    try{
      const r=await fetch('/api/state?t='+encodeURIComponent(token));
      const j=await r.json();
      out.textContent=JSON.stringify(j,null,2);
    }catch(e){
      out.textContent='error: '+String(e);
    }
  }
  async function sendPrompt(){
    const message=(document.getElementById('prompt').value||'').trim();
    const deliverAs=document.getElementById('delivery').value;
    const status=document.getElementById('sendStatus');
    if(!message){ status.textContent='mensagem vazia'; return; }
    status.textContent='enviando...';
    try{
      const r=await fetch('/api/prompt?t='+encodeURIComponent(token),{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({message,deliverAs}),
      });
      const j=await r.json();
      if(!r.ok){ status.textContent='erro: '+(j.error||r.status); return; }
      status.textContent='ok';
      document.getElementById('prompt').value='';
      setTimeout(()=>{ status.textContent=''; },1500);
      tick();
    }catch(e){
      status.textContent='erro: '+String(e);
    }
  }
  document.getElementById('send').addEventListener('click', sendPrompt);
  tick();
  setInterval(tick,2000);
</script>
</body>
</html>`;
}

function safeJson(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function tryExtractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const c of content) {
    if (!c || typeof c !== "object") continue;
    const p = c as { type?: string; text?: string };
    if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
  }

  return parts.join("\n");
}

function openBrowser(pi: ExtensionAPI, url: string): Promise<boolean> {
  return (async () => {
    try {
      if (process.platform === "win32") {
        const r = await pi.exec("cmd", ["/c", "start", "", url], { timeout: 5000 });
        return r.code === 0;
      }
      if (process.platform === "darwin") {
        const r = await pi.exec("open", [url], { timeout: 5000 });
        return r.code === 0;
      }
      const r = await pi.exec("xdg-open", [url], { timeout: 5000 });
      return r.code === 0;
    } catch {
      return false;
    }
  })();
}

function snapshot(config: GatewayConfig, rt: GatewayRuntime, state: WebState) {
  const url = rt.running
    ? buildGatewayAccessUrl({
      mode: config.mode,
      bindHost: rt.bindHost,
      advertisedHost: config.advertisedHost,
      port: rt.port,
      token: rt.token,
    })
    : undefined;

  return {
    mode: config.mode,
    bindHost: rt.bindHost,
    advertisedHost: config.advertisedHost,
    running: rt.running,
    port: rt.port,
    startedAt: rt.startedAt,
    accessUrl: url,
    token: rt.token,
    state,
  };
}

export default function webSessionGateway(pi: ExtensionAPI) {
  let config: GatewayConfig = { ...DEFAULT_CONFIG };

  const webState: WebState = {
    monitorMode: "unknown",
    sessionFile: undefined,
    colonies: [],
    recentSignals: [],
    recentMessages: [],
  };

  const runtime: GatewayRuntime = {
    running: false,
    bindHost: getBindHost(config.mode),
    port: config.port,
    token: randomBytes(24).toString("hex"),
  };

  let sessionCtx: ExtensionContext | undefined;

  function updateStatus(ctx?: ExtensionContext) {
    if (!ctx?.hasUI) return;
    const text = runtime.running
      ? `[web] ${config.mode} http://${buildAccessHost(config.mode, runtime.bindHost, config.advertisedHost)}:${runtime.port}`
      : undefined;
    ctx.ui.setStatus("web-session-gateway", text);
  }

  async function stopServer() {
    const server = runtime.server;
    if (!server) return;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    runtime.server = undefined;
    runtime.running = false;
    runtime.startedAt = undefined;
  }

  async function startServer(ctx: ExtensionContext) {
    if (runtime.running) return;

    runtime.bindHost = getBindHost(config.mode);
    runtime.port = config.port;

    const server = createServer((req, res) => {
      const u = parseUrl(req);

      if (u.pathname === "/api/health") {
        const uptime = runtime.startedAt ? Math.floor((Date.now() - runtime.startedAt) / 1000) : 0;
        safeJson(res, { status: "ok", uptime, mode: config.mode });
        return;
      }

      if (!requireToken(req, runtime.token)) {
        unauthorized(res);
        return;
      }

      if (u.pathname === "/api/state") {
        safeJson(res, snapshot(config, runtime, webState));
        return;
      }

      if (u.pathname === "/api/prompt" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
          if (body.length > 200_000) req.destroy();
        });
        req.on("end", () => {
          let parsed: unknown;
          try {
            parsed = body ? JSON.parse(body) : {};
          } catch {
            safeJson(res, { error: "invalid_json" }, 400);
            return;
          }

          const payload = parsePromptPayload(parsed);
          if (!payload.ok) {
            safeJson(res, { error: payload.error }, 400);
            return;
          }

          pi.sendUserMessage(payload.message, { deliverAs: payload.deliverAs });
          safeJson(res, { accepted: true, deliverAs: payload.deliverAs });
        });
        req.on("error", () => {
          safeJson(res, { error: "request_error" }, 400);
        });
        return;
      }

      if (u.pathname === "/") {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(renderHtml());
        return;
      }

      safeJson(res, { error: "not_found" }, 404);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(runtime.port, runtime.bindHost, () => resolve());
    });

    runtime.server = server;
    runtime.running = true;
    runtime.startedAt = Date.now();
    updateStatus(ctx);
  }

  function pushRecentMessage(role: string, text: string) {
    const content = text.trim();
    if (!content) return;

    webState.recentMessages.push({ at: Date.now(), role, text: content });
    if (webState.recentMessages.length > MESSAGE_LIMIT) {
      webState.recentMessages.splice(0, webState.recentMessages.length - MESSAGE_LIMIT);
    }
  }

  function trackText(text: string) {
    if (!text) return;

    const sig = parseColonySignal(text);
    if (sig) {
      const idx = webState.colonies.findIndex((c) => c.id === sig.id);
      const next = { id: sig.id, phase: sig.phase, updatedAt: Date.now() };
      if (idx >= 0) webState.colonies[idx] = next;
      else webState.colonies.push(next);

      webState.recentSignals.push({ at: Date.now(), text });
      if (webState.recentSignals.length > SIGNAL_LIMIT) {
        webState.recentSignals.splice(0, webState.recentSignals.length - SIGNAL_LIMIT);
      }
    }

    if (text.includes("/monitors off")) webState.monitorMode = "off";
    if (text.includes("/monitors on")) webState.monitorMode = "on";
  }

  pi.on("session_start", (event, ctx) => {
    sessionCtx = ctx;

    const cfg = readSettingsConfig(ctx.cwd);
    config = {
      mode: resolveGatewayMode(cfg.mode),
      port: typeof cfg.port === "number" ? cfg.port : DEFAULT_CONFIG.port,
      advertisedHost: cfg.advertisedHost,
    };

    runtime.bindHost = getBindHost(config.mode);
    runtime.port = config.port;

    webState.monitorMode = "unknown";
    webState.sessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
    webState.colonies = [];
    webState.recentSignals = [];
    webState.recentMessages = [];

    updateStatus(ctx);

    if (event.reason === "reload") {
      // Keep server lifecycle manual and deterministic.
    }
  });

  pi.on("message_end", (event, _ctx) => {
    const message = (event as { message?: unknown }).message as { role?: string } | undefined;
    const text = tryExtractText(message);
    trackText(text);

    const role = message?.role;
    if (role === "user" || role === "assistant" || role === "toolResult") {
      pushRecentMessage(role, text);
    }
  });

  pi.on("tool_result", (event) => {
    const text = tryExtractText(event);
    trackText(text);
    pushRecentMessage("tool_result", text);
  });

  pi.registerTool({
    name: "session_web_status",
    label: "Session Web Status",
    description: "Get current web-session-gateway status and access URL.",
    parameters: Type.Object({}),
    async execute() {
      const data = snapshot(config, runtime, webState);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: data,
      };
    },
  });

  pi.registerCommand("session-web", {
    description: "Manage first-party local web session gateway (start/status/open/stop).",
    handler: async (args, ctx) => {
      const { cmd } = parseCommandInput(args ?? "");
      const action = cmd || "status";

      if (action === "start") {
        await startServer(ctx);
        const data = snapshot(config, runtime, webState);
        ctx.ui.notify(
          `web-session-gateway active (${config.mode})\n${data.accessUrl}\nhealth: http://127.0.0.1:${runtime.port}/api/health`,
          "info"
        );
        return;
      }

      if (action === "stop") {
        await stopServer();
        updateStatus(ctx);
        ctx.ui.notify("web-session-gateway stopped", "info");
        return;
      }

      if (action === "open") {
        if (!runtime.running) {
          ctx.ui.notify("Gateway is not running. Use /session-web start", "warning");
          return;
        }
        const data = snapshot(config, runtime, webState);
        const url = data.accessUrl!;
        const ok = await openBrowser(pi, url);
        if (ok) ctx.ui.notify(`Opening ${url}`, "info");
        else ctx.ui.notify(`Could not open browser automatically. URL: ${url}`, "warning");
        return;
      }

      if (action === "status") {
        const data = snapshot(config, runtime, webState);
        ctx.ui.notify(JSON.stringify(data, null, 2), "info");
        return;
      }

      ctx.ui.notify("Usage: /session-web <start|status|open|stop>", "warning");
    },
  });

  pi.on("session_shutdown", async () => {
    await stopServer();
    updateStatus(sessionCtx);
  });
}
