/**
 * web-session-gateway — First-party local web observability for pi sessions.
 * @capability-id session-web-observability
 * @capability-criticality medium
 *
 * Philosophy:
 * - deterministic access URL by mode (local/lan/public)
 * - no dependency on hosted third-party UI domain
 * - minimal HTTP surface for session/colony visibility
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { parseColonySignal, parseCommandInput } from "./colony-pilot";
import {
	formatBoardClockStatus,
	readBoardClockSnapshot,
	type BoardClockSnapshot,
} from "./board-clock";

type GatewayMode = "local" | "lan" | "public";

interface GatewayConfig {
	mode: GatewayMode;
	port: number;
	advertisedHost?: string;
	compactLargeJson: boolean;
	maxInlineJsonChars: number;
}

interface WebState {
	monitorMode: "on" | "off" | "unknown";
	sessionFile?: string;
	boardClock: BoardClockSnapshot;
	colonies: Array<{ id: string; phase: string; updatedAt: number }>;
	recentSignals: Array<{ at: number; text: string }>;
	recentMessages: Array<{ at: number; role: string; text: string }>;
}

export interface WebStateSummary {
	monitorMode: "on" | "off" | "unknown";
	board: {
		exists: boolean;
		total: number;
		inProgress: number;
		blocked: number;
		planned: number;
	};
	colonies: {
		tracked: number;
		live: number;
		failed: number;
		lastPhase?: string;
		lastAgeSec?: number;
	};
	signals: {
		count: number;
		lastAgeSec?: number;
	};
	messages: {
		count: number;
		lastRole?: string;
		lastAgeSec?: number;
	};
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
	compactLargeJson: true,
	maxInlineJsonChars: 1800,
};

const SIGNAL_LIMIT = 40;
const MESSAGE_LIMIT = 80;
const RUNTIME_FILE = join(".pi", "session-web-runtime.json");

function writeRuntimeFile(
	cwd: string,
	config: GatewayConfig,
	rt: GatewayRuntime,
) {
	try {
		const url = buildGatewayAccessUrl({
			mode: config.mode,
			bindHost: rt.bindHost,
			advertisedHost: config.advertisedHost,
			port: rt.port,
			token: rt.token,
		});

		writeFileSync(
			join(cwd, RUNTIME_FILE),
			JSON.stringify(
				{
					running: rt.running,
					mode: config.mode,
					bindHost: rt.bindHost,
					port: rt.port,
					url,
					updatedAt: Date.now(),
				},
				null,
				2,
			),
		);
	} catch {
		// best-effort observability file
	}
}

function clearRuntimeFile(cwd: string) {
	try {
		const p = join(cwd, RUNTIME_FILE);
		if (existsSync(p)) unlinkSync(p);
	} catch {
		// ignore
	}
}

export function resolveGatewayMode(input?: string): GatewayMode {
	if (input === "lan" || input === "public" || input === "local") return input;
	return "local";
}

export function getBindHost(mode: GatewayMode): string {
	return mode === "local" ? "127.0.0.1" : "0.0.0.0";
}

export function buildAccessHost(
	mode: GatewayMode,
	bindHost: string,
	advertisedHost?: string,
): string {
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
	const host = buildAccessHost(
		input.mode,
		input.bindHost,
		input.advertisedHost,
	);
	return `http://${host}:${input.port}/?t=${input.token}`;
}

function readSettingsConfig(cwd: string): Partial<GatewayConfig> {
	try {
		const p = join(cwd, ".pi", "settings.json");
		if (!existsSync(p)) return {};
		const json = JSON.parse(readFileSync(p, "utf8"));
		const cfg =
			json?.piStack?.webSessionGateway ??
			json?.extensions?.webSessionGateway ??
			{};
		return {
			mode: resolveGatewayMode(cfg.mode),
			port: typeof cfg.port === "number" ? cfg.port : undefined,
			advertisedHost:
				typeof cfg.advertisedHost === "string" ? cfg.advertisedHost : undefined,
			compactLargeJson: cfg.compactLargeJson !== false,
			maxInlineJsonChars:
				typeof cfg.maxInlineJsonChars === "number" &&
				Number.isFinite(cfg.maxInlineJsonChars)
					? Math.max(400, Math.min(20_000, Math.floor(cfg.maxInlineJsonChars)))
					: undefined,
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

export function isPromptDelivery(
	value: unknown,
): value is "followUp" | "steer" {
	return value === "followUp" || value === "steer";
}

export function parsePromptPayload(
	raw: unknown,
):
	| { ok: true; message: string; deliverAs: "followUp" | "steer" }
	| { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "payload must be an object" };
	}

	const payload = raw as { message?: unknown; deliverAs?: unknown };
	const message =
		typeof payload.message === "string" ? payload.message.trim() : "";
	if (!message) {
		return { ok: false, error: "message is required" };
	}

	const deliverAs = isPromptDelivery(payload.deliverAs)
		? payload.deliverAs
		: "followUp";
	return { ok: true, message, deliverAs };
}

export function buildWebStateSummary(
	state: Pick<
		WebState,
		"monitorMode" | "boardClock" | "colonies" | "recentSignals" | "recentMessages"
	>,
	nowMs = Date.now(),
): WebStateSummary {
	const lastSignal = state.recentSignals[state.recentSignals.length - 1];
	const lastMessage = state.recentMessages[state.recentMessages.length - 1];
	const sortedColonies = [...state.colonies].sort((a, b) => b.updatedAt - a.updatedAt);
	const lastColony = sortedColonies[0];
	const live = sortedColonies.filter((c) =>
		c.phase !== "completed" &&
		c.phase !== "failed" &&
		c.phase !== "aborted" &&
		c.phase !== "budget_exceeded",
	).length;
	const failed = sortedColonies.filter((c) =>
		c.phase === "failed" || c.phase === "aborted" || c.phase === "budget_exceeded",
	).length;

	return {
		monitorMode: state.monitorMode,
		board: {
			exists: state.boardClock.exists,
			total: state.boardClock.total,
			inProgress: state.boardClock.byStatus["in-progress"] ?? 0,
			blocked: state.boardClock.byStatus.blocked ?? 0,
			planned: state.boardClock.byStatus.planned ?? 0,
		},
		colonies: {
			tracked: state.colonies.length,
			live,
			failed,
			lastPhase: lastColony?.phase,
			lastAgeSec: lastColony ? Math.max(0, Math.floor((nowMs - lastColony.updatedAt) / 1000)) : undefined,
		},
		signals: {
			count: state.recentSignals.length,
			lastAgeSec: lastSignal ? Math.max(0, Math.floor((nowMs - lastSignal.at) / 1000)) : undefined,
		},
		messages: {
			count: state.recentMessages.length,
			lastRole: lastMessage?.role,
			lastAgeSec: lastMessage ? Math.max(0, Math.floor((nowMs - lastMessage.at) / 1000)) : undefined,
		},
	};
}

function renderHtml(): string {
	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>pi session gateway</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif; background:#0b1020; color:#e6edf3; margin:0; padding:16px; }
    .wrap { display:grid; gap:12px; max-width:1100px; margin:0 auto; }
    .card { background:#121a2b; border:1px solid #23314f; border-radius:12px; padding:12px; }
    .header { display:flex; justify-content:space-between; gap:10px; align-items:flex-end; flex-wrap:wrap; }
    h1 { margin:0; font-size:20px; }
    .muted { color:#9fb0cd; }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
    .kpi { background:#0b1324; border:1px solid #223355; border-radius:10px; padding:10px; }
    .kpi .k { font-size:12px; color:#9fb0cd; }
    .kpi .v { font-size:18px; font-weight:600; margin-top:4px; }
    .stack { display:grid; gap:8px; }
    .chips { display:flex; flex-wrap:wrap; gap:6px; }
    .chip { background:#16223b; border:1px solid #2a3f66; border-radius:999px; padding:2px 8px; font-size:12px; white-space:nowrap; }
    textarea, select, button { font: inherit; }
    textarea { width:100%; min-height:78px; background:#0b1324; color:#e6edf3; border:1px solid #223355; border-radius:8px; padding:8px; }
    select { background:#0b1324; color:#e6edf3; border:1px solid #223355; border-radius:8px; padding:6px; }
    button { background:#1f6feb; color:white; border:none; border-radius:8px; padding:8px 12px; cursor:pointer; }
    pre { background:#0b1324; border:1px solid #223355; border-radius:8px; padding:10px; overflow:auto; max-height:46vh; }
    details > summary { cursor:pointer; user-select:none; }
    @media (max-width: 920px) { .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width: 620px) { body { padding:10px; } .grid { grid-template-columns:1fr; } .controls { flex-direction:column; align-items:stretch !important; } }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="card">
      <div class="header">
        <div>
          <h1>pi session gateway</h1>
          <div class="muted">summary-first · atualização automática a cada 2s</div>
        </div>
        <div class="muted" id="health">connecting...</div>
      </div>
    </section>

    <section class="card">
      <div class="grid" id="summaryGrid">
        <div class="kpi"><div class="k">Board</div><div class="v" id="kBoard">-</div></div>
        <div class="kpi"><div class="k">Colonies</div><div class="v" id="kColonies">-</div></div>
        <div class="kpi"><div class="k">Signals</div><div class="v" id="kSignals">-</div></div>
        <div class="kpi"><div class="k">Messages</div><div class="v" id="kMessages">-</div></div>
      </div>
    </section>

    <section class="card stack">
      <div><strong>Colonies (recentes)</strong></div>
      <div id="colonyChips" class="chips"></div>
      <div class="muted" id="colonyMeta"></div>
    </section>

    <section class="card stack">
      <div><strong>Prompt</strong></div>
      <textarea id="prompt" placeholder="Enviar mensagem para a sessão..."></textarea>
      <div class="controls" style="display:flex;gap:8px;align-items:center">
        <select id="delivery">
          <option value="followUp">followUp (seguro)</option>
          <option value="steer">steer (enquanto streama)</option>
        </select>
        <button id="send">Enviar</button>
        <span id="sendStatus" class="muted"></span>
      </div>
    </section>

    <section class="card">
      <details>
        <summary><strong>Raw JSON (auditoria)</strong></summary>
        <pre id="raw">loading...</pre>
      </details>
    </section>
  </div>
<script>
  const raw=document.getElementById('raw');
  const token=new URLSearchParams(location.search).get('t')||'';

  function fmtAge(sec){
    if(sec===undefined||sec===null) return 'n/a';
    if(sec<60) return String(sec)+'s';
    const m=Math.floor(sec/60);
    const s=sec%60;
    if(m<60) return String(m)+'m'+(s?String(s)+'s':'');
    const h=Math.floor(m/60);
    const rm=m%60;
    return String(h)+'h'+(rm?String(rm)+'m':'');
  }

  function chip(text){ return '<span class="chip">'+text+'</span>'; }

  function renderSummary(payload){
    const summary=(payload&&payload.summary)||{};
    const board=summary.board||{};
    const colonies=summary.colonies||{};
    const signals=summary.signals||{};
    const messages=summary.messages||{};

    document.getElementById('kBoard').textContent =
      (board.exists ? ('ip='+String(board.inProgress||0)+' blk='+String(board.blocked||0)+' plan='+String(board.planned||0)) : 'board n/a');
    document.getElementById('kColonies').textContent =
      'live='+String(colonies.live||0)+' fail='+String(colonies.failed||0)+' total='+String(colonies.tracked||0);
    document.getElementById('kSignals').textContent =
      String(signals.count||0)+' · last '+fmtAge(signals.lastAgeSec);
    document.getElementById('kMessages').textContent =
      String(messages.count||0)+' · '+(messages.lastRole||'n/a')+' · '+fmtAge(messages.lastAgeSec);

    document.getElementById('health').textContent =
      'mode='+(payload.mode||'n/a')+' · monitor='+(summary.monitorMode||'unknown')+' · running='+(payload.running?'yes':'no');
  }

  function renderColonies(payload){
    const state=(payload&&payload.state)||{};
    const colonies=Array.isArray(state.colonies)?state.colonies.slice().sort((a,b)=>b.updatedAt-a.updatedAt):[];
    const chips = colonies.slice(0,12).map(c=>chip(String(c.id)+':'+String(c.phase))).join('');
    document.getElementById('colonyChips').innerHTML = chips || '<span class="muted">sem colônias rastreadas</span>';
    const hidden=Math.max(0, colonies.length-12);
    const extra=hidden>0?(' · +'+String(hidden)+' hidden') : '';
    document.getElementById('colonyMeta').textContent = 'tracked='+String(colonies.length)+extra;
  }

  function renderRaw(payload){
    raw.textContent = JSON.stringify(payload,null,2);
  }

  async function tick(){
    try{
      const r=await fetch('/api/state?t='+encodeURIComponent(token));
      const j=await r.json();
      renderSummary(j);
      renderColonies(j);
      renderRaw(j);
    }catch(e){
      raw.textContent='error: '+String(e);
      document.getElementById('health').textContent='offline';
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
				const r = await pi.exec("cmd", ["/c", "start", "", url], {
					timeout: 5000,
				});
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
		summary: buildWebStateSummary(state),
		state,
	};
}

function formatGatewayJsonOutput(
	config: GatewayConfig,
	label: string,
	data: unknown,
): string {
	const pretty = JSON.stringify(data, null, 2);
	if (!config.compactLargeJson || pretty.length <= config.maxInlineJsonChars) {
		return pretty;
	}

	const maxPreview = Math.max(200, config.maxInlineJsonChars - 120);
	const preview = pretty.slice(0, maxPreview).trimEnd();
	return [
		`${label}: output compactado (${pretty.length} chars > ${config.maxInlineJsonChars})`,
		"preview:",
		preview,
		"...",
		"(payload completo disponível em details)",
	].join("\n");
}

export default function webSessionGateway(pi: ExtensionAPI) {
	let config: GatewayConfig = { ...DEFAULT_CONFIG };

	const webState: WebState = {
		monitorMode: "unknown",
		sessionFile: undefined,
		boardClock: readBoardClockSnapshot(process.cwd()),
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
		ctx.ui.setStatus("board-clock", formatBoardClockStatus(webState.boardClock));
	}

	function refreshBoardClock(ctx?: ExtensionContext) {
		const cwd = ctx?.cwd ?? sessionCtx?.cwd ?? process.cwd();
		webState.boardClock = readBoardClockSnapshot(cwd);
		if (ctx) updateStatus(ctx);
		else if (sessionCtx) updateStatus(sessionCtx);
	}

	async function stopServer() {
		const server = runtime.server;
		const runtimeCwd = sessionCtx?.cwd ?? process.cwd();

		if (!server) {
			runtime.running = false;
			runtime.startedAt = undefined;
			clearRuntimeFile(runtimeCwd);
			return;
		}

		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});

		runtime.server = undefined;
		runtime.running = false;
		runtime.startedAt = undefined;
		clearRuntimeFile(runtimeCwd);
	}

	async function startServer(ctx: ExtensionContext) {
		if (runtime.running) return;

		runtime.bindHost = getBindHost(config.mode);
		runtime.port = config.port;

		const server = createServer((req, res) => {
			const u = parseUrl(req);

			if (u.pathname === "/api/health") {
				const uptime = runtime.startedAt
					? Math.floor((Date.now() - runtime.startedAt) / 1000)
					: 0;
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
		writeRuntimeFile(ctx.cwd, config, runtime);
	}

	function pushRecentMessage(role: string, text: string) {
		const content = text.trim();
		if (!content) return;

		webState.recentMessages.push({ at: Date.now(), role, text: content });
		if (webState.recentMessages.length > MESSAGE_LIMIT) {
			webState.recentMessages.splice(
				0,
				webState.recentMessages.length - MESSAGE_LIMIT,
			);
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
				webState.recentSignals.splice(
					0,
					webState.recentSignals.length - SIGNAL_LIMIT,
				);
			}
		}

		if (text.includes("/monitors off")) webState.monitorMode = "off";
		if (text.includes("/monitors on")) webState.monitorMode = "on";
	}

	pi.on("session_start", (event, ctx) => {
		sessionCtx = ctx;
		clearRuntimeFile(ctx.cwd);

		const cfg = readSettingsConfig(ctx.cwd);
		config = {
			mode: resolveGatewayMode(cfg.mode),
			port: typeof cfg.port === "number" ? cfg.port : DEFAULT_CONFIG.port,
			advertisedHost: cfg.advertisedHost,
			compactLargeJson: cfg.compactLargeJson !== false,
			maxInlineJsonChars:
				typeof cfg.maxInlineJsonChars === "number"
					? cfg.maxInlineJsonChars
					: DEFAULT_CONFIG.maxInlineJsonChars,
		};

		runtime.bindHost = getBindHost(config.mode);
		runtime.port = config.port;

		webState.monitorMode = "unknown";
		webState.sessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
		webState.colonies = [];
		webState.recentSignals = [];
		webState.recentMessages = [];
		refreshBoardClock(ctx);

		updateStatus(ctx);

		if (event.reason === "reload") {
			// Keep server lifecycle manual and deterministic.
		}
	});

	pi.on("message_end", (event, ctx) => {
		const message = (event as { message?: unknown }).message as
			| { role?: string }
			| undefined;
		const text = tryExtractText(message);
		trackText(text);

		const role = message?.role;
		if (role === "user" || role === "assistant" || role === "toolResult") {
			pushRecentMessage(role, text);
		}
		refreshBoardClock(ctx);
	});

	pi.on("tool_result", (event, ctx) => {
		const text = tryExtractText(event);
		trackText(text);
		pushRecentMessage("tool_result", text);
		refreshBoardClock(ctx);
	});

	pi.registerTool({
		name: "session_web_status",
		label: "Session Web Status",
		description: "Get current web-session-gateway status and access URL.",
		parameters: Type.Object({}),
		async execute() {
			const data = snapshot(config, runtime, webState);
			return {
				content: [
					{
						type: "text",
						text: formatGatewayJsonOutput(config, "session_web_status", data),
					},
				],
				details: data,
			};
		},
	});

	pi.registerCommand("session-web", {
		description:
			"Manage first-party local web session gateway (start/status/open/stop).",
		handler: async (args, ctx) => {
			const { cmd } = parseCommandInput(args ?? "");
			const action = cmd || "status";

			if (action === "start") {
				await startServer(ctx);
				const data = snapshot(config, runtime, webState);
				ctx.ui.notify(
					`web-session-gateway active (${config.mode})\n${data.accessUrl}\nhealth: http://127.0.0.1:${runtime.port}/api/health`,
					"info",
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
					ctx.ui.notify(
						"Gateway is not running. Use /session-web start",
						"warning",
					);
					return;
				}
				const data = snapshot(config, runtime, webState);
				const url = data.accessUrl!;
				const ok = await openBrowser(pi, url);
				if (ok) ctx.ui.notify(`Opening ${url}`, "info");
				else
					ctx.ui.notify(
						`Could not open browser automatically. URL: ${url}`,
						"warning",
					);
				return;
			}

			if (action === "status") {
				const data = snapshot(config, runtime, webState);
				ctx.ui.notify(
					formatGatewayJsonOutput(config, "session-web status", data),
					"info",
				);
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
