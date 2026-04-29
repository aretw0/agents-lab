/**
 * claude-code-adapter — experimental external runtime bridge.
 *
 * Provides Claude Code CLI as a full provider in the pi router:
 * - Request-based budget governor (subscription = $0/token, but rate-limited)
 * - `claude_code_execute` tool with dry-run and cwd isolation
 * - Budget state machine: ok / warn / block based on per-session request cap
 * - Provider hint for routeModelRefs integration
 *
 * @capability-id claude-code-adapter
 * @capability-criticality medium
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Runtime status (detection)
// ---------------------------------------------------------------------------

export interface ClaudeCodeRuntimeStatus {
  available: boolean;
  binaryPath?: string;
  authStatus: "authenticated" | "unauthenticated" | "unknown";
  notes: string[];
}

// ---------------------------------------------------------------------------
// Request-based budget (Claude Code subscription model)
// ---------------------------------------------------------------------------

export interface ClaudeCodeRequestBudgetConfig {
  /** Hard cap: block at this many requests per session (default: 20). */
  sessionRequestCap: number;
  /** Warn threshold as fraction of cap (default: 0.75 → warn at 75%). */
  warnFraction: number;
}

export interface ClaudeCodeBudgetState {
  requestsUsed: number;
  requestsCap: number;
  warnAt: number;
  state: "ok" | "warn" | "block";
  period: "session";
  notes: string[];
}

const DEFAULT_REQUEST_CAP = 20;
const DEFAULT_WARN_FRACTION = 0.75;

export function parseClaudeCodeRequestBudget(raw: unknown): ClaudeCodeRequestBudgetConfig {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const cap = typeof r["sessionRequestCap"] === "number" && r["sessionRequestCap"] > 0
    ? Math.floor(r["sessionRequestCap"])
    : DEFAULT_REQUEST_CAP;
  const warnFraction = typeof r["warnFraction"] === "number"
    && r["warnFraction"] > 0
    && r["warnFraction"] < 1
    ? r["warnFraction"]
    : DEFAULT_WARN_FRACTION;
  return { sessionRequestCap: cap, warnFraction };
}

export function checkBudgetGate(used: number, cfg: ClaudeCodeRequestBudgetConfig): ClaudeCodeBudgetState {
  const cap = cfg.sessionRequestCap;
  const warnAt = Math.ceil(cap * cfg.warnFraction);
  const notes: string[] = [];
  let state: ClaudeCodeBudgetState["state"] = "ok";

  if (used >= cap) {
    state = "block";
    notes.push(`Session request cap reached (${used}/${cap}). Reset session or increase sessionRequestCap.`);
  } else if (used >= warnAt) {
    state = "warn";
    notes.push(`Approaching session request cap (${used}/${cap}). Consider pausing after current task.`);
  }

  return { requestsUsed: used, requestsCap: cap, warnAt, state, period: "session", notes };
}

// ---------------------------------------------------------------------------
// Provider hint for routeModelRefs integration
// ---------------------------------------------------------------------------

export interface ClaudeCodeProviderHint {
  suggestedRouteModelRef: string;
  budgetUnit: "requests";
  notes: string[];
}

export function buildProviderHint(binaryPath: string | undefined): ClaudeCodeProviderHint {
  const notes: string[] = [
    "Claude Code uses a subscription model: cost = $0/token, but requests are rate-limited.",
    "Configure request budget in .pi/settings.json under piStack.quotaVisibility.providerBudgets['claude-code'].",
    "Use unit: 'requests' and weeklyQuotaRequests to match subscription rate limits.",
  ];
  if (!binaryPath) {
    notes.unshift("Binary not found. Install Claude Code and ensure 'claude' is in PATH.");
  }
  return {
    suggestedRouteModelRef: "claude-code/claude-sonnet-4-6",
    budgetUnit: "requests",
    notes,
  };
}

// ---------------------------------------------------------------------------
// Binary detection + auth
// ---------------------------------------------------------------------------

export function parseWhichLikeOutput(stdout: string): string | undefined {
  const line = (stdout ?? "").split(/\r?\n/).map((x) => x.trim()).find(Boolean);
  return line && line.length > 0 ? line : undefined;
}

/**
 * Pure function — interprets `claude auth status` output into a typed auth
 * status. Extracted so it can be unit-tested without invoking the CLI.
 *
 * Rules (applied in order):
 *  1. Non-zero exit code → "unauthenticated"
 *  2. Combined stdout+stderr contains a "not logged in" or "unauthenticated"
 *     signal phrase (case-insensitive) → "unauthenticated"
 *  3. Contains an affirmative phrase ("logged in", "authenticated") → "authenticated"
 *  4. Otherwise → "unknown" (output exists but is ambiguous)
 */
export function parseAuthStatusOutput(
  stdout: string,
  stderr: string,
  exitCode: number,
): ClaudeCodeRuntimeStatus["authStatus"] {
  if (exitCode !== 0) return "unauthenticated";

  const combined = `${stdout ?? ""}\n${stderr ?? ""}`.toLowerCase();

  // Explicit unauthenticated signals
  if (
    combined.includes("not logged") ||
    combined.includes("not authenticated") ||
    combined.includes("unauthenticated") ||
    combined.includes("login required") ||
    combined.includes("please log in") ||
    combined.includes("please login")
  ) {
    return "unauthenticated";
  }

  // Explicit authenticated signals
  if (
    combined.includes("logged in") ||
    combined.includes("authenticated") ||
    combined.includes("you are signed in") ||
    combined.includes("account:")
  ) {
    return "authenticated";
  }

  return "unknown";
}

async function detectClaudeBinary(pi: ExtensionAPI): Promise<string | undefined> {
  const candidates = process.platform === "win32"
    ? [["where", ["claude"]], ["where", ["claude-code"]]]
    : [["which", ["claude"]], ["which", ["claude-code"]]];

  for (const [cmd, args] of candidates) {
    try {
      const r = await pi.exec(cmd, args as string[], { timeout: 5000 });
      if (r.code !== 0) continue;
      const path = parseWhichLikeOutput(r.stdout ?? "");
      if (path) return path;
    } catch {
      // ignore probe failures
    }
  }

  return undefined;
}

async function detectClaudeAuth(pi: ExtensionAPI, binaryPath: string): Promise<ClaudeCodeRuntimeStatus["authStatus"]> {
  const cmd = binaryPath.toLowerCase().endsWith(".exe") ? binaryPath : "claude";
  try {
    const r = await pi.exec(cmd, ["auth", "status"], { timeout: 8000 });
    return parseAuthStatusOutput(r.stdout ?? "", r.stderr ?? "", r.code);
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Goal execution — uses pi.exec with array args (no shell interpolation)
// ---------------------------------------------------------------------------

export interface ClaudeCodeExecuteResult {
  dryRun: boolean;
  budgetState: ClaudeCodeBudgetState;
  output?: string;
  exitCode?: number;
  error?: string;
  binaryPath?: string;
}

/**
 * Runs `claude --print <goal>` as a subprocess.
 * Array-form args prevent shell injection — goal is passed as a separate
 * element, never interpolated into a shell string.
 */
async function runClaudeSubprocess(
  pi: ExtensionAPI,
  binaryPath: string,
  printArgs: string[],
  opts: { timeout: number; cwd?: string },
): Promise<{ output: string; exitCode: number; error?: string }> {
  const cmd = binaryPath.toLowerCase().endsWith(".exe") ? binaryPath : "claude";
  try {
    const r = await pi.exec(cmd, printArgs, opts);
    const output = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
    return { output, exitCode: r.code };
  } catch (e) {
    return { output: "", exitCode: -1, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function claudeCodeAdapterExtension(pi: ExtensionAPI) {
  // In-session request counter — resets on extension reload
  let sessionRequests = 0;
  const budgetCfg = parseClaudeCodeRequestBudget({});

  // ---- tool: claude_code_adapter_status ----------------------------------

  pi.registerTool({
    name: "claude_code_adapter_status",
    label: "Claude Code Adapter Status",
    description: "Claude Code provider health: binary detection, auth status, and request budget state.",
    parameters: Type.Object({}),
    async execute() {
      const binaryPath = await detectClaudeBinary(pi);
      const available = Boolean(binaryPath);
      const authStatus = binaryPath ? await detectClaudeAuth(pi, binaryPath) : "unknown";
      const budgetState = checkBudgetGate(sessionRequests, budgetCfg);
      const providerHint = buildProviderHint(binaryPath);
      const notes: string[] = [];

      if (!available) notes.push("Claude Code binary not found (expected: claude/claude-code in PATH).");
      if (available && authStatus !== "authenticated") {
        notes.push("Use official CLI auth flow: 'claude auth login'.");
        notes.push("Browser automation should remain local opt-in fallback only.");
      }

      const payload: ClaudeCodeRuntimeStatus & {
        budgetState: ClaudeCodeBudgetState;
        providerHint: ClaudeCodeProviderHint;
      } = { available, binaryPath, authStatus, notes, budgetState, providerHint };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  });

  // ---- tool: claude_code_execute -----------------------------------------

  pi.registerTool({
    name: "claude_code_execute",
    label: "Claude Code Execute",
    description: [
      "Execute a goal via Claude Code CLI subprocess ('claude --print <goal>').",
      "Request-budget gated: blocked when session cap is reached.",
      "Set dry_run=true to preview budget state without invoking the subprocess.",
      "Set cwd to a specific directory for deterministic swarm isolation.",
    ].join(" "),
    parameters: Type.Object({
      goal: Type.String({ description: "The goal or prompt to execute via Claude Code CLI." }),
      cwd: Type.Optional(Type.String({ description: "Working directory for subprocess isolation." })),
      dry_run: Type.Optional(Type.Boolean({ description: "Preview budget state without executing. Default: false." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Subprocess timeout in milliseconds. Default: 120000." })),
    }),
    async execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const goal = typeof p.goal === "string" ? p.goal : "";
      const cwd = typeof p.cwd === "string" ? p.cwd : undefined;
      const dry_run = typeof p.dry_run === "boolean" ? p.dry_run : false;
      const timeout_ms = typeof p.timeout_ms === "number" ? p.timeout_ms : undefined;
      const isDryRun = dry_run ?? false;
      const timeoutMs = typeof timeout_ms === "number" && timeout_ms > 0 ? timeout_ms : 120_000;
      const budgetState = checkBudgetGate(sessionRequests, budgetCfg);

      const base: ClaudeCodeExecuteResult = { dryRun: isDryRun, budgetState };

      if (budgetState.state === "block") {
        return {
          content: [{ type: "text", text: JSON.stringify({ ...base, error: "Budget blocked." }, null, 2) }],
          details: base,
        };
      }

      if (isDryRun) {
        const preview = {
          ...base,
          goal,
          cwd: cwd ?? process.cwd(),
          note: "Dry-run: subprocess not invoked.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(preview, null, 2) }],
          details: preview,
        };
      }

      const binaryPath = await detectClaudeBinary(pi);
      if (!binaryPath) {
        return {
          content: [{ type: "text", text: JSON.stringify({ ...base, error: "Claude Code binary not found." }, null, 2) }],
          details: base,
        };
      }

      sessionRequests += 1;
      // Array-form args: ["--print", goal] — goal is a separate element, not shell-interpolated.
      const subprocessArgs = ["--print", goal];
      const { output, exitCode, error } = await runClaudeSubprocess(
        pi, binaryPath, subprocessArgs, { timeout: timeoutMs, cwd },
      );
      const updated = checkBudgetGate(sessionRequests, budgetCfg);

      const result: ClaudeCodeExecuteResult = {
        ...base,
        budgetState: updated,
        binaryPath,
        output,
        exitCode,
        error,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  // ---- command: /claude-code ---------------------------------------------

  pi.registerCommand("claude-code", {
    description: "Claude Code provider bridge. Subcommands: status | budget | login | auth-status | run <goal>",
    handler: async (args, ctx) => {
      const input = (args ?? "status").trim();
      const firstSpace = input.indexOf(" ");
      const subCmd = (firstSpace >= 0 ? input.slice(0, firstSpace) : input).toLowerCase();
      const remainder = firstSpace >= 0 ? input.slice(firstSpace + 1).trim() : "";

      if (subCmd === "status" || !subCmd) {
        const binaryPath = await detectClaudeBinary(pi);
        const available = Boolean(binaryPath);
        const authStatus = binaryPath ? await detectClaudeAuth(pi, binaryPath) : "unknown";
        const budgetState = checkBudgetGate(sessionRequests, budgetCfg);
        ctx.ui.notify(
          [
            "claude-code adapter",
            `available: ${available ? "yes" : "no"}`,
            `binary: ${binaryPath ?? "(not found)"}`,
            `authStatus: ${authStatus}`,
            `budget: ${budgetState.requestsUsed}/${budgetState.requestsCap} requests [${budgetState.state}]`,
            "credentials: never persisted by this adapter",
          ].join("\n"),
          available ? "info" : "warning"
        );
        return;
      }

      if (subCmd === "budget") {
        const budgetState = checkBudgetGate(sessionRequests, budgetCfg);
        const hint = buildProviderHint(undefined);
        ctx.ui.notify(
          [
            "claude-code budget (session)",
            `requests used: ${budgetState.requestsUsed}`,
            `cap: ${budgetState.requestsCap}`,
            `warn at: ${budgetState.warnAt}`,
            `state: ${budgetState.state}`,
            "",
            "provider integration hint:",
            `  suggestedRouteModelRef: ${hint.suggestedRouteModelRef}`,
            "  add to .pi/settings.json:",
            '  piStack.quotaVisibility.routeModelRefs["claude-code"] = "claude-code/claude-sonnet-4-6"',
            '  piStack.quotaVisibility.providerBudgets["claude-code"].unit = "requests"',
            ...budgetState.notes,
          ].join("\n"),
          budgetState.state === "block" ? "error" : budgetState.state === "warn" ? "warning" : "info"
        );
        return;
      }

      if (subCmd === "login") {
        ctx.ui.notify(
          [
            "claude-code login bridge",
            "Use official login flow:",
            "  claude auth login",
            "No credentials are stored by pi-stack.",
          ].join("\n"),
          "info"
        );
        ctx.ui.setEditorText?.("claude auth login");
        return;
      }

      if (subCmd === "auth-status") {
        const binaryPath = await detectClaudeBinary(pi);
        const authStatus = binaryPath ? await detectClaudeAuth(pi, binaryPath) : "unknown";
        ctx.ui.notify(
          `claude-code auth-status: ${authStatus}`,
          authStatus === "authenticated" ? "info" : "warning"
        );
        return;
      }

      if (subCmd === "run") {
        if (!remainder) {
          ctx.ui.notify("Usage: /claude-code run <goal>", "warning");
          return;
        }
        const budgetState = checkBudgetGate(sessionRequests, budgetCfg);
        if (budgetState.state === "block") {
          ctx.ui.notify(
            `Budget blocked: ${budgetState.requestsUsed}/${budgetState.requestsCap} requests used. Reset session or increase cap.`,
            "error"
          );
          return;
        }
        const binaryPath = await detectClaudeBinary(pi);
        if (!binaryPath) {
          ctx.ui.notify("Claude Code binary not found. Install and ensure 'claude' is in PATH.", "error");
          return;
        }
        ctx.ui.notify(
          `Executing via Claude Code (request ${sessionRequests + 1}/${budgetState.requestsCap})...`,
          "info"
        );
        sessionRequests += 1;
        const runArgs = ["--print", remainder];
        const { output, exitCode, error } = await runClaudeSubprocess(
          pi, binaryPath, runArgs, { timeout: 120_000 },
        );
        const updated = checkBudgetGate(sessionRequests, budgetCfg);
        const lines = [
          `claude-code run: exit=${exitCode} | budget=${updated.requestsUsed}/${updated.requestsCap} [${updated.state}]`,
        ];
        if (error) lines.push(`error: ${error}`);
        if (output) lines.push("", output.slice(0, 2000));
        ctx.ui.notify(lines.join("\n"), exitCode === 0 ? "info" : "warning");
        return;
      }

      ctx.ui.notify("Usage: /claude-code <status|budget|login|auth-status|run <goal>>", "warning");
    },
  });
}
