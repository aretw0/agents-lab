#!/usr/bin/env node

/**
 * Session + board triage focused on recent activity (default: last 1 day).
 *
 * Why this exists:
 * - Build a compact operational view from recent pi session history
 * - Reconcile branch-summary follow-ups with board pending work
 * - Separate "unlock swarm now" vs "later stabilization" actions
 *
 * Usage:
 *   node scripts/session-triage.mjs
 *   node scripts/session-triage.mjs --days 2 --limit 12
 *   node scripts/session-triage.mjs --events ./data/canonical-events.json
 *   node scripts/session-triage.mjs --ideas ./notes/inbox.md
 *   node scripts/session-triage.mjs --summary-store ./.sandbox/pi-agent/triage/branch-summary-store.json
 *   node scripts/session-triage.mjs --no-summary-store
 *   node scripts/session-triage.mjs --json
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    days: 1,
    limit: 8,
    json: false,
    workspace: process.cwd(),
    eventsPath: undefined,
    summaryStore: true,
    summaryStorePath: undefined,
    tailLines: 160,
    window: 1,
    expand: false,
    allowGlobalFallback: false,
    ideaSources: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") {
      out.days = Number(argv[i + 1] ?? out.days);
      i++;
      continue;
    }
    if (a === "--limit") {
      out.limit = Number(argv[i + 1] ?? out.limit);
      i++;
      continue;
    }
    if (a === "--workspace") {
      out.workspace = argv[i + 1] ?? out.workspace;
      i++;
      continue;
    }
    if (a === "--events") {
      out.eventsPath = argv[i + 1] ?? out.eventsPath;
      i++;
      continue;
    }
    if (a === "--json") {
      out.json = true;
      continue;
    }
    if (a === "--summary-store") {
      out.summaryStore = true;
      out.summaryStorePath = argv[i + 1] ?? out.summaryStorePath;
      i++;
      continue;
    }
    if (a === "--no-summary-store") {
      out.summaryStore = false;
      continue;
    }
    if (a === "--tail-lines") {
      out.tailLines = Number(argv[i + 1] ?? out.tailLines);
      i++;
      continue;
    }
    if (a === "--window") {
      out.window = Number(argv[i + 1] ?? out.window);
      i++;
      continue;
    }
    if (a === "--expand") {
      out.expand = true;
      continue;
    }
    if (a === "--allow-global-fallback") {
      out.allowGlobalFallback = true;
      continue;
    }
    if (a === "--ideas" || a === "--idea-inbox") {
      const src = argv[i + 1];
      if (src) out.ideaSources.push(src);
      i++;
      continue;
    }
  }

  if (!Number.isFinite(out.days) || out.days <= 0) out.days = 1;
  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = 8;
  if (!Number.isFinite(out.tailLines) || out.tailLines <= 0) out.tailLines = 160;
  if (!Number.isFinite(out.window) || out.window <= 0) out.window = 1;
  return out;
}

function toSessionWorkspaceKey(absPath) {
  const resolved = path.resolve(absPath).replace(/\\/g, "/");
  const drive = resolved.match(/^([A-Za-z]):\/(.*)$/);
  if (drive) {
    const letter = drive[1].toUpperCase();
    const rest = drive[2]
      .split("/")
      .filter(Boolean)
      .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "-"))
      .join("-");
    return `--${letter}--${rest}--`;
  }

  const rest = resolved
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "-"))
    .join("-");
  return `--${rest}--`;
}

function resolveSessionScanConfig(workspace, key, opts) {
  const localSessionDir = path.join(workspace, ".sandbox", "pi-agent", "sessions", key);
  const globalSessionDir = path.join(homedir(), ".pi", "agent", "sessions", key);
  const effectiveWindow = Math.max(1, opts.expand ? Math.max(2, opts.window) : opts.window);
  const lineBudget = Math.max(1, Math.floor(opts.tailLines)) * effectiveWindow;

  if (existsSync(localSessionDir)) {
    return {
      sessionDir: localSessionDir,
      sessionDirSource: "local-sandbox",
      lineBudget,
      effectiveWindow,
    };
  }

  if (opts.allowGlobalFallback && existsSync(globalSessionDir)) {
    return {
      sessionDir: globalSessionDir,
      sessionDirSource: "global-fallback",
      lineBudget,
      effectiveWindow,
    };
  }

  return {
    sessionDir: localSessionDir,
    sessionDirSource: "local-sandbox-missing",
    lineBudget,
    effectiveWindow,
  };
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .join("\n");
}

function extractSummaryBlock(text) {
  const tagged = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (tagged?.[1]) return tagged[1].trim();

  const hasSummaryHint =
    /summary of a branch/i.test(text) ||
    /conversation history before this point was compacted/i.test(text) ||
    /the following is a summary/i.test(text);

  if (!hasSummaryHint) return null;
  return text.trim();
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionBullets(summary, title) {
  const rx = new RegExp(`##\\s*${escapeRegex(title)}\\s*([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const block = summary.match(rx)?.[1] ?? "";
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l) || /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
}

function addCount(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

const TOOLING_GAP_RULES = [
  {
    code: "command-not-found",
    pattern: /(?:\bcommand not found\b|is not recognized as an internal or external command)/i,
    recommendation: "Solicitar bootstrap de executáveis antes de iniciar o lote.",
  },
  {
    code: "spawn-enoent",
    pattern: /(?:spawn(?:Sync)?\s+[^\n]*\bENOENT\b|\bENOENT\b)/i,
    recommendation: "Abrir claim de capability faltante e bloquear execução até remediação.",
  },
  {
    code: "missing-capability",
    pattern: /(?:missingCapabilities|missing capabilities)/i,
    recommendation: "Registrar capability gap e pedir permissão para construir/adicionar ferramenta.",
  },
  {
    code: "missing-executable",
    pattern: /(?:missingExecutables|missing executables)/i,
    recommendation: "Executar preflight/hatch e corrigir executáveis requeridos antes de continuar.",
  },
  {
    code: "instructions-required",
    pattern: /Instructions are required/i,
    recommendation: "Classificar como blocker de contrato e corrigir instruções antes de delegar.",
  },
];

function detectToolingGapCodes(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  const out = [];
  for (const rule of TOOLING_GAP_RULES) {
    if (rule.pattern.test(text)) out.push(rule.code);
  }
  return out;
}

function buildToolingClaimCandidates(gapTotals) {
  const recommendationByCode = new Map(TOOLING_GAP_RULES.map((r) => [r.code, r.recommendation]));
  return Object.entries(gapTotals)
    .map(([code, count]) => ({
      code,
      count,
      recommendation: recommendationByCode.get(code) ?? "Registrar blocker e pedir remediação explícita.",
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function stableIdeaId(text) {
  const normalized = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 5381;
  for (const ch of normalized) hash = ((hash << 5) + hash) ^ ch.charCodeAt(0);
  return `IDEA-${(hash >>> 0).toString(36).toUpperCase()}`;
}

function normalizeIdeaTitle(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/[`*_#>\[\]]/g, "")
    .trim()
    .slice(0, 180);
}

function extractIdeaCandidatesFromText(text, source) {
  const out = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;

    const matches = [
      line.match(/^[-*]\s+(?:\[[ xX]\]\s*)?(?:💡\s*)?(?:idea|ideia|inbox)\s*[:\-–]\s+(.+)$/i),
      line.match(/^#{1,6}\s+(?:💡\s*)?(?:idea|ideia|inbox)\s*[:\-–]\s+(.+)$/i),
      line.match(/^(?:💡\s*)?(?:idea|ideia|inbox)\s*[:\-–]\s+(.+)$/i),
      line.match(/^>\s*\[!(?:idea|ideia|inbox)\]\s*(.*)$/i),
    ].find(Boolean);

    if (!matches) continue;
    const title = normalizeIdeaTitle(matches[1] || lines[index + 1] || "");
    if (!title) continue;
    out.push({
      id: stableIdeaId(`${source.kind}:${source.ref}:${title}`),
      title,
      source: { ...source, line: index + 1 },
      taskDraft: {
        status: "planned",
        description: title,
        acceptance_criteria: [
          "Human review confirms priority/scope before autonomous execution.",
          "Origin reference remains attached to the promoted task.",
          "No auto-close or aggressive priority promotion is applied by the inbox pipeline.",
        ],
        references: [source.ref],
      },
      decisionGate: {
        requiresHumanApproval: true,
        requiresVerification: true,
        noAutoClose: true,
      },
    });
  }
  return out;
}

function collectIdeaInbox({ ideaSources, sessions }) {
  const proposals = [];

  for (const rawPath of ideaSources ?? []) {
    const sourcePath = path.resolve(rawPath);
    if (!existsSync(sourcePath)) continue;
    const stat = statSync(sourcePath);
    const files = stat.isDirectory()
      ? readdirSync(sourcePath)
          .filter((name) => /\.(?:md|markdown)$/i.test(name))
          .map((name) => path.join(sourcePath, name))
      : [sourcePath];

    for (const file of files) {
      if (!/\.(?:md|markdown)$/i.test(file)) continue;
      const text = readFileSync(file, "utf8");
      proposals.push(...extractIdeaCandidatesFromText(text, { kind: "markdown", ref: path.resolve(file) }));
    }
  }

  for (const session of sessions ?? []) {
    for (const candidate of session.ideaCandidates ?? []) proposals.push(candidate);
  }

  const byKey = new Map();
  for (const proposal of proposals) {
    const key = proposal.title.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, proposal);
  }

  const deduped = [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    proposalCount: deduped.length,
    reviewRequired: deduped.length > 0,
    promotionPolicy: "draft-planned-task-only; human-review-required; no-auto-close; no-aggressive-priority",
    proposals: deduped,
  };
}

function recommendDelegationLane(report) {
  const claims = Array.isArray(report?.aggregate?.toolingClaims) ? report.aggregate.toolingClaims : [];
  const claimCount = claims.reduce((sum, item) => sum + (Number(item?.count) || 0), 0);
  const completeSignals = Number(report?.aggregate?.colonySignals?.COMPLETE ?? 0);
  const unlockNowCount = Array.isArray(report?.board?.unlockNow) ? report.board.unlockNow.length : 0;
  const blockedNowCount = Array.isArray(report?.board?.unlockNow)
    ? report.board.unlockNow.filter((t) => t?.status === "blocked").length
    : 0;

  if (claimCount > 0) {
    return {
      lane: "bootstrap-first",
      confidence: "high",
      reasons: [
        `toolingClaims=${claimCount}`,
        "Existem gaps de ferramenta/capability que devem ser tratados antes da delegação.",
      ],
      nextAction: "Abrir claim de capability, corrigir bootstrap/permissão e só então delegar execução.",
      metrics: { claimCount, completeSignals, unlockNowCount, blockedNowCount },
    };
  }

  if (completeSignals <= 0) {
    return {
      lane: "subagent-warmup",
      confidence: "medium",
      reasons: ["Sem sinal COMPLETE recente no recorte.", "Delegação leve recomendada antes de swarm."],
      nextAction: "Rodar 1 subtask curta com subagent-as-tool e reavaliar readiness.",
      metrics: { claimCount, completeSignals, unlockNowCount, blockedNowCount },
    };
  }

  if (unlockNowCount >= 3) {
    return {
      lane: "swarm-candidate",
      confidence: "medium",
      reasons: [
        `unlockNow=${unlockNowCount}`,
        "Backlog urgente com sinais de execução recente suficiente para escalar.",
      ],
      nextAction: "Executar gate strict (preflight/readiness/quota) e lançar swarm curto com budget explícito.",
      metrics: { claimCount, completeSignals, unlockNowCount, blockedNowCount },
    };
  }

  return {
    lane: "subagent-as-tool",
    confidence: "high",
    reasons: [
      "Sem tooling claims ativas.",
      `COMPLETE=${completeSignals}`,
      "Escalar por delegação leve antes de swarm total.",
    ],
    nextAction: "Delegar micro-slice para subagent e manter coordenação no control-plane.",
    metrics: { claimCount, completeSignals, unlockNowCount, blockedNowCount },
  };
}

function toIsoOrFallback(raw, fallbackIso) {
  if (!raw) return fallbackIso;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return fallbackIso;
  return d.toISOString();
}

function normalizeSummaryEntry(entry, fallbackSource = "unknown", fallbackSeenAt = new Date().toISOString()) {
  return {
    nextSteps: dedupeStrings(entry?.nextSteps ?? []),
    inProgress: dedupeStrings(entry?.inProgress ?? []),
    blocked: dedupeStrings(entry?.blocked ?? []),
    source: typeof entry?.source === "string" && entry.source.trim() ? entry.source : fallbackSource,
    seenAt: toIsoOrFallback(entry?.seenAt, fallbackSeenAt),
  };
}

function summaryFingerprint(entry) {
  const pack = (arr) => dedupeStrings(arr).map((x) => x.toLowerCase()).sort().join("|");
  return `${pack(entry.nextSteps)}::${pack(entry.inProgress)}::${pack(entry.blocked)}`;
}

function mergeSummaryEntries(existingEntries, incomingEntries) {
  const byFingerprint = new Map();

  for (const raw of [...existingEntries, ...incomingEntries]) {
    const norm = normalizeSummaryEntry(raw);
    const key = summaryFingerprint(norm);
    const prev = byFingerprint.get(key);
    if (!prev) {
      byFingerprint.set(key, norm);
      continue;
    }
    const prevMs = new Date(prev.seenAt).getTime();
    const currMs = new Date(norm.seenAt).getTime();
    if (Number.isFinite(currMs) && (!Number.isFinite(prevMs) || currMs >= prevMs)) {
      byFingerprint.set(key, norm);
    }
  }

  return [...byFingerprint.values()].sort((a, b) => new Date(b.seenAt).getTime() - new Date(a.seenAt).getTime());
}

function loadSummaryStore(storePath) {
  if (!storePath || !existsSync(storePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8"));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.map((entry) => normalizeSummaryEntry(entry));
  } catch {
    return [];
  }
}

function writeSummaryStore(storePath, entries, retentionDays = 30, maxEntries = 500) {
  if (!storePath) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const filtered = entries
    .filter((entry) => new Date(entry.seenAt).getTime() >= cutoff)
    .slice(0, maxEntries);

  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    retentionDays,
    entries: filtered,
  };

  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(payload, null, 2));
}

function parseSessionFile(filePath, lineBudget) {
  const allLines = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);

  const effectiveLineBudget = Number.isFinite(lineBudget) && lineBudget > 0
    ? Math.max(1, Math.floor(lineBudget))
    : undefined;
  const lines = effectiveLineBudget ? allLines.slice(-effectiveLineBudget) : allLines;

  const out = {
    file: path.basename(filePath),
    path: filePath,
    updatedAt: new Date(statSync(filePath).mtimeMs).toISOString(),
    messageCount: 0,
    userMessages: 0,
    assistantMessages: 0,
    colonySignals: {},
    toolingGaps: {},
    ideaCandidates: [],
    branchSummaries: [],
    totalLineCount: allLines.length,
    scannedLineCount: lines.length,
    truncatedLineCount: Math.max(0, allLines.length - lines.length),
  };

  const signalCount = new Map();
  const toolingGapCount = new Map();

  for (const line of lines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    if (rec?.type !== "message") continue;
    const role = rec?.message?.role;
    const text = extractText(rec?.message?.content);
    out.messageCount += 1;
    if (role === "user") out.userMessages += 1;
    if (role === "assistant") out.assistantMessages += 1;

    const matches = [...text.matchAll(/\[COLONY_SIGNAL:([A-Z_]+)\]/g)];
    for (const m of matches) addCount(signalCount, m[1]);

    for (const code of detectToolingGapCodes(text)) addCount(toolingGapCount, code);

    out.ideaCandidates.push(
      ...extractIdeaCandidatesFromText(text, {
        kind: "session",
        ref: path.basename(filePath),
        role: String(role ?? "unknown"),
      }),
    );

    if (role !== "toolResult") {
      const summary = extractSummaryBlock(text);
      if (summary) {
        out.branchSummaries.push(
          normalizeSummaryEntry(
            {
              nextSteps: sectionBullets(summary, "Next Steps"),
              inProgress: sectionBullets(summary, "In Progress"),
              blocked: sectionBullets(summary, "Blocked"),
              source: path.basename(filePath),
              seenAt: toIsoOrFallback(rec?.timestamp ?? rec?.createdAt, out.updatedAt),
            },
            path.basename(filePath),
            out.updatedAt,
          ),
        );
      }
    }
  }

  out.colonySignals = Object.fromEntries([...signalCount.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  out.toolingGaps = Object.fromEntries([...toolingGapCount.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  return out;
}

function normalizeCanonicalText(event) {
  if (!event || typeof event !== "object") return "";
  if (typeof event.text === "string") return event.text;
  if (typeof event.message === "string") return event.message;
  if (typeof event.content === "string") return event.content;
  if (Array.isArray(event.content)) return extractText(event.content);
  return "";
}

function parseCanonicalEventsInput(eventsPath) {
  const rawText = readFileSync(eventsPath, "utf8");

  try {
    const parsed = JSON.parse(rawText);
    const events = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.events)
        ? parsed.events
        : parsed && typeof parsed === "object" && (parsed.event || parsed.source || parsed.text || parsed.message || parsed.content)
          ? [parsed]
          : [];
    return {
      events: Array.isArray(events) ? events : [],
      format: "json",
    };
  } catch {
    // fallback: JSONL (one event per line)
  }

  const events = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return {
    events,
    format: "jsonl",
  };
}

function parseCanonicalEventsFile(eventsPath, cutoffMs) {
  if (!eventsPath || !existsSync(eventsPath)) return null;

  const parsed = parseCanonicalEventsInput(eventsPath);
  const events = parsed?.events ?? [];
  if (!Array.isArray(events) || events.length === 0) return null;

  const signalCount = new Map();
  const providerCount = new Map();
  const toolingGapCount = new Map();
  const out = {
    file: `canonical:${path.basename(eventsPath)}`,
    path: path.resolve(eventsPath),
    format: parsed.format,
    updatedAt: new Date(statSync(eventsPath).mtimeMs).toISOString(),
    messageCount: 0,
    userMessages: 0,
    assistantMessages: 0,
    colonySignals: {},
    toolingGaps: {},
    providers: {},
    ideaCandidates: [],
    branchSummaries: [],
  };

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const source = event.source && typeof event.source === "object" ? event.source : {};
    const ev = event.event && typeof event.event === "object" ? event.event : event;

    const tsRaw = ev.timestampIso ?? ev.timestamp ?? ev.createdAt ?? ev.created_at;
    const ts = tsRaw ? new Date(tsRaw) : undefined;
    if (ts && Number.isFinite(ts.getTime()) && ts.getTime() < cutoffMs) continue;

    const provider = typeof source.provider === "string" && source.provider.trim() ? source.provider.trim().toLowerCase() : "custom";
    addCount(providerCount, provider);

    const roleRaw = ev.role ?? ev.authorRole ?? ev.author_role;
    const role = typeof roleRaw === "string" ? roleRaw.toLowerCase() : "unknown";
    const text = normalizeCanonicalText(ev);

    out.messageCount += 1;
    if (role === "user" || role === "human") out.userMessages += 1;
    if (role === "assistant" || role === "agent" || role === "bot") out.assistantMessages += 1;

    const matches = [...text.matchAll(/\[COLONY_SIGNAL:([A-Z_]+)\]/g)];
    for (const m of matches) addCount(signalCount, m[1]);

    for (const code of detectToolingGapCodes(text)) addCount(toolingGapCount, code);

    out.ideaCandidates.push(
      ...extractIdeaCandidatesFromText(text, {
        kind: "event",
        ref: `canonical:${path.basename(eventsPath)}:${provider}`,
        role,
      }),
    );

    const summary = extractSummaryBlock(text);
    if (summary) {
      out.branchSummaries.push(
        normalizeSummaryEntry(
          {
            nextSteps: sectionBullets(summary, "Next Steps"),
            inProgress: sectionBullets(summary, "In Progress"),
            blocked: sectionBullets(summary, "Blocked"),
            source: `canonical:${path.basename(eventsPath)}:${provider}`,
            seenAt: toIsoOrFallback(tsRaw, out.updatedAt),
          },
          `canonical:${path.basename(eventsPath)}:${provider}`,
          out.updatedAt,
        ),
      );
    }
  }

  out.colonySignals = Object.fromEntries([...signalCount.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  out.toolingGaps = Object.fromEntries([...toolingGapCount.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  out.providers = Object.fromEntries([...providerCount.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  return out;
}

function loadBoardPending(cwd) {
  const tasksPath = path.join(cwd, ".project", "tasks.json");
  if (!existsSync(tasksPath)) {
    return {
      pending: [],
      unlockNow: [],
      later: [],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(tasksPath, "utf8"));
  } catch {
    return { pending: [], unlockNow: [], later: [] };
  }

  const pending = (parsed.tasks ?? []).filter((t) => ["planned", "in-progress", "blocked"].includes(t.status));

  const normalize = (task) => ({
    id: task.id,
    status: task.status,
    description: String(task.description ?? "").replace(/\s+/g, " ").trim(),
  });

  const unlockNow = pending
    .filter((t) => /-promotion$/i.test(t.id) || /\[P0\]/i.test(String(t.description ?? "")) || t.status === "blocked")
    .map(normalize);

  const unlockNowIds = new Set(unlockNow.map((t) => t.id));
  const later = pending.filter((t) => !unlockNowIds.has(t.id)).map(normalize);

  return {
    pending: pending.map(normalize),
    unlockNow,
    later,
  };
}

function dedupeStrings(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function renderHuman(report) {
  const lines = [];
  lines.push(`# Session triage (last ${report.lookbackDays} day(s))`);
  lines.push("");
  lines.push(`Workspace: ${report.workspace}`);
  lines.push(`Session dir: ${report.sessionDir}`);
  if (report.sources?.sessionDirSource) {
    lines.push(`Session source: ${report.sources.sessionDirSource}`);
  }
  if (report.sources?.canonicalEvents) {
    lines.push(`Canonical events: ${report.sources.canonicalEvents}`);
  }
  if ((report.sources?.ideaInbox ?? []).length > 0) {
    lines.push(`Idea inbox sources: ${report.sources.ideaInbox.join(", ")}`);
  }
  if (report.sources?.branchSummaryStore) {
    lines.push(`Branch-summary store: ${report.sources.branchSummaryStore}`);
  }
  lines.push(`Scanned: ${report.sessions.length} file(s)`);
  if (report.scanWindow) {
    lines.push(
      `Scan mode: ${report.scanWindow.mode} lines<=${report.scanWindow.lineBudget} (window=${report.scanWindow.window}, tailLines=${report.scanWindow.tailLines})`,
    );
    if (report.scanWindow.truncatedSessions > 0) {
      lines.push(
        `Scan budget hit in ${report.scanWindow.truncatedSessions} session(s) · use --window ${report.scanWindow.suggestedNextWindow} to expand if needed.`,
      );
    }
  }
  lines.push("");

  lines.push("## Recent sessions");
  if (report.sessions.length === 0) {
    lines.push("- (none found in lookback window)");
  } else {
    for (const s of report.sessions) {
      const sig = Object.entries(s.colonySignals)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      lines.push(`- ${s.file}`);
      lines.push(`  - msgs: ${s.messageCount} (user ${s.userMessages}, assistant ${s.assistantMessages})`);
      if (Number(s.truncatedLineCount) > 0) {
        lines.push(`  - scan lines: ${s.scannedLineCount}/${s.totalLineCount} (tail-batch)`);
      }
      const gaps = Object.entries(s.toolingGaps ?? {})
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      lines.push(`  - branch summaries: ${s.branchSummaries.length}`);
      lines.push(`  - colony signals: ${sig || "none"}`);
      lines.push(`  - tooling gaps: ${gaps || "none"}`);
    }
  }
  lines.push("");

  lines.push("## Source providers (message volume)");
  const providerPairs = Object.entries(report.aggregate.providers ?? {});
  if (providerPairs.length === 0) lines.push("- (none)");
  else providerPairs.forEach(([provider, count]) => lines.push(`- ${provider}: ${count}`));
  lines.push("");

  lines.push("## Tooling blockers (claim candidates)");
  if ((report.aggregate.toolingClaims ?? []).length === 0) {
    lines.push("- (none)");
  } else {
    for (const item of report.aggregate.toolingClaims) {
      lines.push(`- ${item.code}: ${item.count}`);
      lines.push(`  - action: ${item.recommendation}`);
    }
  }
  lines.push("");

  lines.push("## Delegation lane recommendation");
  const rec = report.recommendation ?? { lane: "manual-micro-slice", confidence: "low", reasons: [], nextAction: "Reavaliar sinais." };
  lines.push(`lane: ${rec.lane} (confidence=${rec.confidence})`);
  for (const reason of rec.reasons ?? []) lines.push(`- ${reason}`);
  lines.push(`next: ${rec.nextAction}`);
  lines.push("");

  lines.push(`## Idea inbox proposals (${report.ideaInbox?.proposalCount ?? 0})`);
  if ((report.ideaInbox?.proposals ?? []).length === 0) {
    lines.push("- (none)");
  } else {
    lines.push(`policy: ${report.ideaInbox.promotionPolicy}`);
    for (const item of report.ideaInbox.proposals) {
      lines.push(`- ${item.id}: ${item.title}`);
      lines.push(`  - source: ${item.source.kind}:${item.source.ref}:${item.source.line}`);
      lines.push("  - gate: human-review + verification + no-auto-close");
    }
  }
  lines.push("");

  lines.push(`## Branch-summary aggregation (merged=${report.aggregate.branchSummariesCount ?? 0})`);
  lines.push("### In Progress");
  if (report.aggregate.inProgress.length === 0) lines.push("- (none)");
  else report.aggregate.inProgress.forEach((x) => lines.push(`- ${x}`));
  lines.push("### Blocked");
  if (report.aggregate.blocked.length === 0) lines.push("- (none)");
  else report.aggregate.blocked.forEach((x) => lines.push(`- ${x}`));
  lines.push("### Next Steps");
  if (report.aggregate.nextSteps.length === 0) lines.push("- (none)");
  else report.aggregate.nextSteps.forEach((x) => lines.push(`- ${x}`));
  lines.push("");

  lines.push("## Board pending split");
  lines.push(`Pending total: ${report.board.pending.length}`);
  lines.push("### Unlock swarm now");
  if (report.board.unlockNow.length === 0) lines.push("- (none)");
  else report.board.unlockNow.forEach((t) => lines.push(`- ${t.id} [${t.status}] ${t.description.slice(0, 120)}`));
  lines.push("### Later stabilization");
  if (report.board.later.length === 0) lines.push("- (none)");
  else report.board.later.forEach((t) => lines.push(`- ${t.id} [${t.status}] ${t.description.slice(0, 120)}`));

  return lines.join("\n");
}

const opts = parseArgs(process.argv.slice(2));
const workspace = path.resolve(opts.workspace);
const key = toSessionWorkspaceKey(workspace);
const cutoff = Date.now() - opts.days * 24 * 60 * 60 * 1000;
const scanConfig = resolveSessionScanConfig(workspace, key, opts);
const sessionDir = scanConfig.sessionDir;
const summaryStorePath = opts.summaryStore
  ? path.resolve(opts.summaryStorePath ?? path.join(workspace, ".sandbox", "pi-agent", "triage", "branch-summary-store.json"))
  : null;

let sessions = [];
if (existsSync(sessionDir)) {
  sessions = readdirSync(sessionDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => ({
      name,
      path: path.join(sessionDir, name),
      mtime: statSync(path.join(sessionDir, name)).mtimeMs,
    }))
    .filter((f) => f.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, opts.limit)
    .map((f) => parseSessionFile(f.path, scanConfig.lineBudget));
}

if (opts.eventsPath) {
  const canonical = parseCanonicalEventsFile(path.resolve(opts.eventsPath), cutoff);
  if (canonical) sessions.unshift(canonical);
}

const sessionSummaries = sessions.flatMap((session) =>
  (session.branchSummaries ?? []).map((summary) =>
    normalizeSummaryEntry(summary, session.file, session.updatedAt),
  ),
);

const storedSummaries = summaryStorePath ? loadSummaryStore(summaryStorePath) : [];
const mergedSummaries = mergeSummaryEntries(storedSummaries, sessionSummaries);
if (summaryStorePath) {
  writeSummaryStore(summaryStorePath, mergedSummaries);
}

const allNext = [];
const allInProgress = [];
const allBlocked = [];
const signalTotals = new Map();
const providerTotals = new Map();
const toolingGapTotals = new Map();

for (const bs of mergedSummaries) {
  allNext.push(...bs.nextSteps);
  allInProgress.push(...bs.inProgress);
  allBlocked.push(...bs.blocked);
}

for (const s of sessions) {
  for (const [k, v] of Object.entries(s.colonySignals)) addCount(signalTotals, k, v);
  for (const [k, v] of Object.entries(s.toolingGaps ?? {})) addCount(toolingGapTotals, k, v);

  const providers = s?.providers && typeof s.providers === "object" ? s.providers : null;
  if (providers && Object.keys(providers).length > 0) {
    for (const [provider, count] of Object.entries(providers)) {
      addCount(providerTotals, provider, Number(count) || 0);
    }
  } else {
    addCount(providerTotals, "pi", s.messageCount || 0);
  }
}

const board = loadBoardPending(workspace);
const toolingGaps = Object.fromEntries([...toolingGapTotals.entries()].sort((a, b) => a[0].localeCompare(b[0])));
const truncatedSessions = sessions.filter((s) => Number(s?.truncatedLineCount) > 0).length;
const truncatedLinesTotal = sessions.reduce((sum, s) => sum + (Number(s?.truncatedLineCount) || 0), 0);

const report = {
  generatedAt: new Date().toISOString(),
  workspace,
  lookbackDays: opts.days,
  limit: opts.limit,
  sessionDir,
  sources: {
    piSessionJsonl: existsSync(sessionDir),
    sessionDirSource: scanConfig.sessionDirSource,
    canonicalEvents: opts.eventsPath ? path.resolve(opts.eventsPath) : null,
    ideaInbox: (opts.ideaSources ?? []).map((src) => path.resolve(src)),
    branchSummaryStore: summaryStorePath,
  },
  scanWindow: {
    mode: "tail-batch",
    tailLines: opts.tailLines,
    window: scanConfig.effectiveWindow,
    lineBudget: scanConfig.lineBudget,
    expanded: opts.expand || scanConfig.effectiveWindow > 1,
    truncatedSessions,
    truncatedLinesTotal,
    suggestedNextWindow: scanConfig.effectiveWindow + 1,
  },
  sessions,
  aggregate: {
    colonySignals: Object.fromEntries([...signalTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    toolingGaps,
    toolingClaims: buildToolingClaimCandidates(toolingGaps),
    providers: Object.fromEntries([...providerTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    nextSteps: dedupeStrings(allNext),
    inProgress: dedupeStrings(allInProgress),
    blocked: dedupeStrings(allBlocked),
    branchSummariesCount: mergedSummaries.length,
  },
  branchSummaryStore: {
    enabled: Boolean(summaryStorePath),
    path: summaryStorePath,
    loaded: storedSummaries.length,
    merged: mergedSummaries.length,
    sessionExtracted: sessionSummaries.length,
  },
  board,
  ideaInbox: collectIdeaInbox({ ideaSources: opts.ideaSources, sessions }),
};

report.recommendation = recommendDelegationLane(report);

if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderHuman(report));
}
