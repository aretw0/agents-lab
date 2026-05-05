import { extractUsage, estimateHardPathwayMitigation } from "./quota-visibility";

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as unknown[])
    .map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object") {
        const po = p as Record<string, unknown>;
        if (typeof po["text"] === "string") return po["text"];
        if (typeof po["content"] === "string") return po["content"];
      }
      return "";
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Per-record parsers (pure, testable)
// ---------------------------------------------------------------------------

export interface ColonySignalCount {
  signal: string;
  count: number;
}

export interface ModelChangeEvent {
  timestampIso: string;
  provider: string;
  modelId: string;
}

export interface TimelineEvent {
  timestampIso: string;
  type: string;
  role?: string;
  excerpt?: string;
  signal?: string;
}

export interface ContentOutlierEvent {
  timestampIso: string;
  role?: string;
  toolName?: string;
  textChars: number;
  hasStackOverflow: boolean;
  excerpt: string;
}

export type DelegationMixMode = "local" | "manual" | "simple-delegate" | "swarm";

export interface DelegationMixBucket {
  mode: DelegationMixMode;
  count: number;
  sharePct: number;
  examples: string[];
}

export type DelegationMixRecommendationCode =
  | "delegation-mix-ready-diverse"
  | "delegation-mix-needs-evidence-no-data"
  | "delegation-mix-needs-evidence-simple-delegate-missing"
  | "delegation-mix-needs-evidence-swarm-missing"
  | "delegation-mix-needs-evidence-low-diversity";

export interface DelegationMixScore {
  mode: "delegation-mix-score";
  decision: "ready" | "needs-evidence";
  score: number;
  recommendationCode: DelegationMixRecommendationCode;
  recommendation: string;
  window: {
    lookbackHours: number;
    filesScanned: number;
    totalRecords: number;
  };
  totals: {
    totalEvents: number;
    local: number;
    manual: number;
    simpleDelegate: number;
    swarm: number;
    diversityModes: number;
    delegatedSharePct: number;
  };
  buckets: DelegationMixBucket[];
  dispatchAllowed: false;
  authorization: "none";
  mutationAllowed: false;
  summary: string;
}

export type AutoAdvanceHardIntentRecommendationCode =
  | "auto-advance-telemetry-ready"
  | "auto-advance-telemetry-needs-evidence-no-data"
  | "auto-advance-telemetry-needs-evidence-eligible-missing"
  | "auto-advance-telemetry-needs-hardening-block-rate";

export interface AutoAdvanceHardIntentTelemetry {
  mode: "auto-advance-hard-intent-telemetry";
  decision: "ready" | "needs-evidence";
  score: number;
  recommendationCode: AutoAdvanceHardIntentRecommendationCode;
  recommendation: string;
  window: {
    lookbackHours: number;
    filesScanned: number;
    totalRecords: number;
  };
  totals: {
    totalEvents: number;
    eligibleEvents: number;
    blockedEvents: number;
    blockedRatePct: number;
  };
  blockedReasons: Array<{ reason: string; count: number }>;
  examples: {
    eligible: string[];
    blocked: string[];
  };
  dispatchAllowed: false;
  authorization: "none";
  mutationAllowed: false;
  summary: string;
}

export interface GalvanizationCandidate {
  rank: number;
  patternKey: string;
  label: string;
  kind: "slash-command" | "prompt-pattern" | "tool-loop";
  occurrences: number;
  sessions: number;
  evidence: {
    tokens: number;
    costUsd: number;
    requests: number;
    examplePrompts: string[];
  };
  opportunityScore: number;
  pathway: {
    proposal: string;
    safetyGates: string[];
    equivalenceCondition: string;
    rollbackPlan: string;
  };
  mitigationProjection: ReturnType<typeof estimateHardPathwayMitigation>;
}

function normalizeWorkPatternText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/`[^`]+`/g, "<code>")
    .replace(/[a-z]:\\[^\s]+/gi, "<path>")
    .replace(/\/?[a-z0-9._-]+(?:\/[a-z0-9._-]+){2,}/gi, "<path>")
    .replace(/\b\d+\b/g, "<num>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function classifyWorkPatternKind(text: string): "slash-command" | "prompt-pattern" {
  if (text.trim().startsWith("/")) return "slash-command";
  return "prompt-pattern";
}

function inferDelegationMixModeFromText(textRaw: string): DelegationMixMode | undefined {
  const text = textRaw.toLowerCase();
  if (!text.trim()) return undefined;

  if (text.includes("[colony_signal:") || text.includes("ant_colony") || text.includes("swarm")) {
    return "swarm";
  }
  if (
    text.includes("subagent")
    || text.includes("delegat")
    || text.includes("simple delegate")
    || text.includes("claude_code_execute")
    || text.includes("agent spawn")
    || text.includes("agent_spawn")
  ) {
    return "simple-delegate";
  }
  if (
    text.includes("local-safe")
    || text.includes("local safe")
    || text.includes("local-first")
    || text.includes("local first")
    || text.includes("checkpoint")
    || text.includes("context-watch")
  ) {
    return "local";
  }
  return "manual";
}

function inferDelegationMixModeFromTool(toolNameRaw: string): DelegationMixMode | undefined {
  const toolName = toolNameRaw.toLowerCase();
  if (!toolName.trim()) return undefined;
  if (toolName.includes("ant_colony") || toolName.includes("colony")) return "swarm";
  if (toolName.includes("subagent") || toolName.includes("claude_code_execute") || toolName.includes("agent_spawn")) {
    return "simple-delegate";
  }
  if (toolName.startsWith("context_watch") || toolName.startsWith("git_") || toolName.startsWith("board_")) {
    return "local";
  }
  return undefined;
}

export function parseDelegationMixScore(
  records: unknown[],
  lookbackHours: number,
  filesScanned: number,
): DelegationMixScore {
  const counters: Record<DelegationMixMode, number> = {
    local: 0,
    manual: 0,
    "simple-delegate": 0,
    swarm: 0,
  };
  const examples: Record<DelegationMixMode, string[]> = {
    local: [],
    manual: [],
    "simple-delegate": [],
    swarm: [],
  };

  const pushExample = (mode: DelegationMixMode, value: string) => {
    const text = value.trim();
    if (!text) return;
    if (examples[mode].length >= 3) return;
    examples[mode].push(text.slice(0, 120));
  };

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    const type = typeof r["type"] === "string" ? r["type"] : "";

    if (type === "tool_call") {
      const toolName = typeof r["toolName"] === "string"
        ? r["toolName"]
        : typeof (r["tool"] as Record<string, unknown> | undefined)?.["name"] === "string"
          ? String((r["tool"] as Record<string, unknown>)["name"])
          : "";
      const mode = inferDelegationMixModeFromTool(toolName);
      if (!mode) continue;
      counters[mode] += 1;
      pushExample(mode, `tool:${toolName}`);
      continue;
    }

    if (type !== "message") continue;
    const msg = r["message"] as Record<string, unknown> | undefined;
    if (!msg) continue;
    const role = typeof msg["role"] === "string" ? msg["role"] : "";
    const toolName = typeof msg["toolName"] === "string" ? msg["toolName"] : "";
    const text = extractTextContent(msg["content"]);

    let mode = inferDelegationMixModeFromTool(toolName);
    if (!mode && (role === "user" || role === "assistant" || role === "toolResult")) {
      mode = inferDelegationMixModeFromText(text);
    }
    if (!mode) continue;

    counters[mode] += 1;
    pushExample(mode, toolName ? `tool:${toolName}` : text);
  }

  const totalEvents = Object.values(counters).reduce((sum, value) => sum + value, 0);
  const diversityModes = Object.values(counters).filter((value) => value > 0).length;
  const delegatedEvents = counters["simple-delegate"] + counters.swarm;
  const delegatedSharePct = totalEvents > 0 ? Math.round((delegatedEvents / totalEvents) * 100) : 0;

  const buckets: DelegationMixBucket[] = (["local", "manual", "simple-delegate", "swarm"] as DelegationMixMode[])
    .map((mode) => ({
      mode,
      count: counters[mode],
      sharePct: totalEvents > 0 ? Math.round((counters[mode] / totalEvents) * 100) : 0,
      examples: examples[mode],
    }));

  let decision: DelegationMixScore["decision"] = "ready";
  let recommendationCode: DelegationMixRecommendationCode = "delegation-mix-ready-diverse";
  let recommendation = "delegation mix is diverse enough for bounded delegation progression.";

  if (totalEvents <= 0) {
    decision = "needs-evidence";
    recommendationCode = "delegation-mix-needs-evidence-no-data";
    recommendation = "no delegation evidence observed yet; collect local session evidence before promoting delegation decisions.";
  } else if (counters["simple-delegate"] <= 0) {
    decision = "needs-evidence";
    recommendationCode = "delegation-mix-needs-evidence-simple-delegate-missing";
    recommendation = "simple-delegate evidence missing; add bounded single-delegate slices before broader delegation.";
  } else if (counters.swarm <= 0) {
    decision = "needs-evidence";
    recommendationCode = "delegation-mix-needs-evidence-swarm-missing";
    recommendation = "swarm evidence missing; keep delegation local/simple and defer swarm promotion.";
  } else if (diversityModes < 3) {
    decision = "needs-evidence";
    recommendationCode = "delegation-mix-needs-evidence-low-diversity";
    recommendation = "delegation diversity is low; balance local/manual/simple-delegate/swarm evidence before promotion.";
  }

  const score = totalEvents <= 0
    ? 0
    : Math.max(0, Math.min(100, Math.round((diversityModes / 4) * 60 + delegatedSharePct * 0.4)));

  const summary = [
    "delegation-mix-score:",
    `decision=${decision}`,
    `score=${score}`,
    `events=${totalEvents}`,
    `local=${counters.local}`,
    `manual=${counters.manual}`,
    `simple=${counters["simple-delegate"]}`,
    `swarm=${counters.swarm}`,
    `code=${recommendationCode}`,
    "authorization=none",
  ].join(" ");

  return {
    mode: "delegation-mix-score",
    decision,
    score,
    recommendationCode,
    recommendation,
    window: {
      lookbackHours,
      filesScanned,
      totalRecords: records.length,
    },
    totals: {
      totalEvents,
      local: counters.local,
      manual: counters.manual,
      simpleDelegate: counters["simple-delegate"],
      swarm: counters.swarm,
      diversityModes,
      delegatedSharePct,
    },
    buckets,
    dispatchAllowed: false,
    authorization: "none",
    mutationAllowed: false,
    summary,
  };
}

export function parseAutoAdvanceHardIntentTelemetry(
  records: unknown[],
  lookbackHours: number,
  filesScanned: number,
): AutoAdvanceHardIntentTelemetry {
  const blockedReasons = new Map<string, number>();
  const examples = {
    eligible: [] as string[],
    blocked: [] as string[],
  };

  let eligibleEvents = 0;
  let blockedEvents = 0;

  const pushExample = (bucket: "eligible" | "blocked", text: string) => {
    const clean = text.trim();
    if (!clean || examples[bucket].length >= 3) return;
    examples[bucket].push(clean.slice(0, 140));
  };

  const registerBlockedReasons = (rawText: string) => {
    const match = rawText.match(/fail-closed;[^()]*\(([^)]+)\)/i);
    const parsed = (match?.[1] ?? "")
      .split(/[;,]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const reasons = parsed.length > 0
      ? parsed
      : rawText.toLowerCase().includes("no eligible local-safe successor")
        ? ["no-eligible-local-safe-successor"]
        : ["unknown"];
    for (const reason of reasons) {
      blockedReasons.set(reason, (blockedReasons.get(reason) ?? 0) + 1);
    }
  };

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    if (r["type"] !== "message") continue;
    const msg = r["message"] as Record<string, unknown> | undefined;
    if (!msg) continue;
    const text = extractTextContent(msg["content"]);
    const normalized = text.toLowerCase();

    if (normalized.includes("auto-advance hard-intent:")) {
      eligibleEvents += 1;
      pushExample("eligible", text || "auto-advance hard-intent");
      continue;
    }

    if (normalized.includes("autonomy-lane-auto-advance-snapshot:")) {
      if (normalized.includes("decision=eligible")) {
        eligibleEvents += 1;
        pushExample("eligible", text || "auto-advance snapshot eligible");
        continue;
      }

      if (normalized.includes("decision=blocked")) {
        blockedEvents += 1;
        pushExample("blocked", text || "auto-advance snapshot blocked");
        const reasonMatch = normalized.match(/reasons=([^\s]+)/i);
        if (reasonMatch?.[1]) {
          for (const reason of reasonMatch[1]
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)) {
            blockedReasons.set(reason, (blockedReasons.get(reason) ?? 0) + 1);
          }
        } else if (normalized.includes("auto-advance-snapshot-blocked-no-focus-complete")) {
          blockedReasons.set("focus-not-complete", (blockedReasons.get("focus-not-complete") ?? 0) + 1);
        } else if (normalized.includes("auto-advance-snapshot-blocked-no-successor")) {
          blockedReasons.set(
            "no-eligible-local-safe-successor",
            (blockedReasons.get("no-eligible-local-safe-successor") ?? 0) + 1,
          );
        } else {
          blockedReasons.set("unknown", (blockedReasons.get("unknown") ?? 0) + 1);
        }
        continue;
      }
    }

    if (normalized.includes("hard-intent auto-advance fail-closed") || normalized.includes("auto-advance-hard-intent-blocked")) {
      blockedEvents += 1;
      pushExample("blocked", text || "hard-intent auto-advance fail-closed");
      registerBlockedReasons(text);
    }
  }

  const totalEvents = eligibleEvents + blockedEvents;
  const blockedRatePct = totalEvents > 0 ? Math.round((blockedEvents / totalEvents) * 100) : 0;
  const score = totalEvents > 0 ? Math.max(0, Math.min(100, Math.round((eligibleEvents / totalEvents) * 100))) : 0;

  let decision: AutoAdvanceHardIntentTelemetry["decision"] = "ready";
  let recommendationCode: AutoAdvanceHardIntentRecommendationCode = "auto-advance-telemetry-ready";
  let recommendation = "hard-intent auto-advance has usable evidence with bounded block-rate.";

  if (totalEvents <= 0) {
    decision = "needs-evidence";
    recommendationCode = "auto-advance-telemetry-needs-evidence-no-data";
    recommendation = "no hard-intent auto-advance evidence observed yet; collect local continuity runs first.";
  } else if (eligibleEvents <= 0) {
    decision = "needs-evidence";
    recommendationCode = "auto-advance-telemetry-needs-evidence-eligible-missing";
    recommendation = "only blocked auto-advance events observed; recover eligibility before unattended continuation.";
  } else if (blockedRatePct >= 50) {
    decision = "needs-evidence";
    recommendationCode = "auto-advance-telemetry-needs-hardening-block-rate";
    recommendation = "blocked auto-advance rate is high; harden gates/validation before widening AFK (low-iteration) continuity.";
  }

  const blockedReasonRows = [...blockedReasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const summary = [
    "auto-advance-hard-intent-telemetry:",
    `decision=${decision}`,
    `score=${score}`,
    `events=${totalEvents}`,
    `eligible=${eligibleEvents}`,
    `blocked=${blockedEvents}`,
    `blockedRatePct=${blockedRatePct}`,
    `code=${recommendationCode}`,
    "authorization=none",
  ].join(" ");

  return {
    mode: "auto-advance-hard-intent-telemetry",
    decision,
    score,
    recommendationCode,
    recommendation,
    window: {
      lookbackHours,
      filesScanned,
      totalRecords: records.length,
    },
    totals: {
      totalEvents,
      eligibleEvents,
      blockedEvents,
      blockedRatePct,
    },
    blockedReasons: blockedReasonRows,
    examples,
    dispatchAllowed: false,
    authorization: "none",
    mutationAllowed: false,
    summary,
  };
}

export function parseGalvanizationCandidates(records: unknown[], limit: number): {
  candidates: GalvanizationCandidate[];
  roadmap: {
    baseline: { tokens: number; costUsd: number; requests: number };
    projectedAfterTopCandidates: { tokens: number; costUsd: number; requests: number };
    mitigationPotential: { tokensSaved: number; costUsdSaved: number; requestsSaved: number };
  };
} {
  type PatternBucket = {
    key: string;
    label: string;
    kind: "slash-command" | "prompt-pattern" | "tool-loop";
    occurrences: number;
    sessions: Set<string>;
    tokens: number;
    costUsd: number;
    requests: number;
    examples: string[];
  };

  type PendingOccurrence = { patternKey: string; timestampIso: string; sessionKey: string };

  const buckets = new Map<string, PatternBucket>();
  const pendingUserPatterns: PendingOccurrence[] = [];

  const ensureBucket = (
    key: string,
    label: string,
    kind: "slash-command" | "prompt-pattern" | "tool-loop",
  ): PatternBucket => {
    let existing = buckets.get(key);
    if (!existing) {
      existing = {
        key,
        label,
        kind,
        occurrences: 0,
        sessions: new Set<string>(),
        tokens: 0,
        costUsd: 0,
        requests: 0,
        examples: [],
      };
      buckets.set(key, existing);
    }
    return existing;
  };

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    const timestampIso = typeof r["timestamp"] === "string" ? r["timestamp"] : "";
    const sessionKey = typeof r["_sessionFile"] === "string"
      ? r["_sessionFile"]
      : (timestampIso.slice(0, 10) || "unknown-session");

    if (r["type"] === "message") {
      const msg = r["message"] as Record<string, unknown> | undefined;
      if (!msg) continue;

      const role = typeof msg["role"] === "string" ? msg["role"] : "";
      const text = extractTextContent(msg["content"]).trim();
      const toolName = typeof msg["toolName"] === "string" ? msg["toolName"] : undefined;

      if (role === "user" && text.length > 0) {
        const normalized = normalizeWorkPatternText(text);
        if (normalized.length < 6) continue;
        const kind = classifyWorkPatternKind(text);
        const key = `${kind}:${normalized}`;
        const bucket = ensureBucket(key, text.slice(0, 120), kind);
        bucket.occurrences += 1;
        bucket.sessions.add(sessionKey);
        if (bucket.examples.length < 3) bucket.examples.push(text.slice(0, 160));
        pendingUserPatterns.push({ patternKey: key, timestampIso, sessionKey });
        continue;
      }

      if (toolName) {
        const key = `tool-loop:${toolName.toLowerCase()}`;
        const bucket = ensureBucket(key, `tool:${toolName}`, "tool-loop");
        bucket.occurrences += 1;
        bucket.sessions.add(sessionKey);
        bucket.requests += 1;
        if (bucket.examples.length < 3 && text.length > 0) {
          bucket.examples.push(text.slice(0, 160));
        }
      }

      if (role === "assistant") {
        const usage = extractUsage((msg as Record<string, unknown>)["usage"] ?? msg);
        if (usage.totalTokens <= 0 && usage.costTotalUsd <= 0) continue;

        const pending = pendingUserPatterns.shift();
        if (!pending) continue;

        const bucket = buckets.get(pending.patternKey);
        if (!bucket) continue;
        bucket.tokens += usage.totalTokens;
        bucket.costUsd += usage.costTotalUsd;
        bucket.requests += 1;
      }
      continue;
    }

    if (r["type"] === "tool_call") {
      const toolName = typeof r["toolName"] === "string"
        ? r["toolName"]
        : typeof (r["tool"] as Record<string, unknown> | undefined)?.["name"] === "string"
          ? ((r["tool"] as Record<string, unknown>)["name"] as string)
          : undefined;
      if (!toolName) continue;
      const key = `tool-loop:${toolName.toLowerCase()}`;
      const bucket = ensureBucket(key, `tool:${toolName}`, "tool-loop");
      bucket.occurrences += 1;
      bucket.sessions.add(sessionKey);
      bucket.requests += 1;
    }
  }

  const filtered = [...buckets.values()]
    .filter((b) => b.occurrences >= 2)
    .filter((b) => b.tokens > 0 || b.costUsd > 0 || b.requests >= 3);

  const scored = filtered
    .map((b) => {
      const freqScore = Math.min(45, b.occurrences * 6);
      const spendScore = Math.min(40, Math.log10(Math.max(1, b.tokens) + 1) * 10 + b.costUsd * 2.5);
      const spreadScore = Math.min(15, b.sessions.size * 3);
      const opportunityScore = Math.round(freqScore + spendScore + spreadScore);
      const pathwayProposal = b.kind === "slash-command"
        ? "Promover para comando/tool deterministic-first com input schema e execução idempotente."
        : b.kind === "tool-loop"
          ? "Extrair pipeline hard (script/workflow) com parâmetros explícitos e retries determinísticos."
          : "Converter em template de intent + workflow fixo, com fallback manual apenas em exceções.";

      const mitigationProjection = estimateHardPathwayMitigation({
        baselineTokens: b.tokens,
        baselineCostUsd: b.costUsd,
        baselineRequests: b.requests,
        automationCoveragePct: b.kind === "tool-loop" ? 0.85 : 0.75,
        residualLlmPct: b.kind === "slash-command" ? 0.08 : 0.15,
        riskBufferPct: 0.05,
      });

      return {
        patternKey: b.key,
        label: b.label,
        kind: b.kind,
        occurrences: b.occurrences,
        sessions: b.sessions.size,
        evidence: {
          tokens: b.tokens,
          costUsd: b.costUsd,
          requests: b.requests,
          examplePrompts: b.examples,
        },
        opportunityScore,
        pathway: {
          proposal: pathwayProposal,
          safetyGates: [
            "equivalence-check em fixture representativo antes de ativar",
            "rollout em dry-run + fallback manual explícito",
            "verification passed no board antes de promover como default",
          ],
          equivalenceCondition:
            "Saída do pathway hard preserva resultado funcional e trilha de evidência do fluxo manual.",
          rollbackPlan:
            "Desativar pathway hard por flag/profile e retornar ao fluxo manual auditado sem perda de estado.",
        },
        mitigationProjection,
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.evidence.tokens - a.evidence.tokens)
    .slice(0, Math.max(1, limit))
    .map((row, idx) => ({ rank: idx + 1, ...row }));

  const baseline = scored.reduce(
    (acc, row) => {
      acc.tokens += row.evidence.tokens;
      acc.costUsd += row.evidence.costUsd;
      acc.requests += row.evidence.requests;
      return acc;
    },
    { tokens: 0, costUsd: 0, requests: 0 },
  );

  const projectedAfterTopCandidates = scored.reduce(
    (acc, row) => {
      acc.tokens += row.mitigationProjection.projectedAfterHardPathway.tokens;
      acc.costUsd += row.mitigationProjection.projectedAfterHardPathway.costUsd;
      acc.requests += row.mitigationProjection.projectedAfterHardPathway.requests;
      return acc;
    },
    { tokens: 0, costUsd: 0, requests: 0 },
  );

  return {
    candidates: scored,
    roadmap: {
      baseline,
      projectedAfterTopCandidates,
      mitigationPotential: {
        tokensSaved: Math.max(0, baseline.tokens - projectedAfterTopCandidates.tokens),
        costUsdSaved: Math.max(0, baseline.costUsd - projectedAfterTopCandidates.costUsd),
        requestsSaved: Math.max(0, baseline.requests - projectedAfterTopCandidates.requests),
      },
    },
  };
}

export function parseSignals(records: unknown[]): ColonySignalCount[] {
  const counts = new Map<string, number>();
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    if (r["type"] !== "message") continue;
    const msg = r["message"] as Record<string, unknown> | undefined;
    if (!msg) continue;
    const text = extractTextContent(msg["content"]);
    const matches = [...text.matchAll(/\[COLONY_SIGNAL:([A-Z_]+)\]/g)];
    for (const m of matches) {
      const key = m[1];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([signal, count]) => ({ signal, count }));
}

export function parseModelChanges(records: unknown[]): ModelChangeEvent[] {
  const out: ModelChangeEvent[] = [];
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    if (r["type"] !== "model_change") continue;
    out.push({
      timestampIso: typeof r["timestamp"] === "string" ? r["timestamp"] : "",
      provider: typeof r["provider"] === "string" ? r["provider"] : "unknown",
      modelId: typeof r["modelId"] === "string" ? r["modelId"] : "unknown",
    });
  }
  return out;
}

export function parseTimeline(records: unknown[], limit: number): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    const ts = typeof r["timestamp"] === "string" ? r["timestamp"] : "";
    const type = typeof r["type"] === "string" ? r["type"] : "unknown";

    if (type === "message") {
      const msg = r["message"] as Record<string, unknown> | undefined;
      const role = typeof msg?.["role"] === "string" ? msg["role"] : undefined;
      const text = msg ? extractTextContent(msg["content"]) : "";
      const signals = [...text.matchAll(/\[COLONY_SIGNAL:([A-Z_]+)\]/g)].map((m) => m[1]);
      if (signals.length > 0) {
        for (const signal of signals) {
          out.push({ timestampIso: ts, type: "colony_signal", role, signal });
        }
      } else if (role === "user" || role === "assistant") {
        out.push({ timestampIso: ts, type, role, excerpt: text.slice(0, 120) });
      }
    } else if (type === "model_change") {
      out.push({
        timestampIso: ts,
        type,
        excerpt: `${r["provider"] ?? ""}/${r["modelId"] ?? ""}`,
      });
    } else if (type === "branch_summary") {
      out.push({ timestampIso: ts, type, excerpt: "(branch summary)" });
    } else if (type === "compaction") {
      out.push({ timestampIso: ts, type, excerpt: "(context compacted)" });
    }

    if (out.length >= limit) break;
  }
  return out;
}

export function parseContentOutliers(records: unknown[], limit: number, minChars: number): {
  outliers: ContentOutlierEvent[];
  stackOverflowHits: number;
} {
  const outliers: ContentOutlierEvent[] = [];
  let stackOverflowHits = 0;

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    if (r["type"] !== "message") continue;

    const msg = r["message"] as Record<string, unknown> | undefined;
    if (!msg) continue;

    const role = typeof msg["role"] === "string" ? msg["role"] : undefined;
    const toolName = typeof msg["toolName"] === "string" ? msg["toolName"] : undefined;
    const text = extractTextContent(msg["content"]);
    const textChars = text.length;
    const hasStackOverflow = text.includes("Maximum call stack size exceeded")
      || text.includes("wrapTextWithAnsi")
      || text.includes("truncateToVisualLines");

    if (hasStackOverflow) stackOverflowHits += 1;

    if (textChars >= minChars || hasStackOverflow) {
      outliers.push({
        timestampIso: typeof r["timestamp"] === "string" ? r["timestamp"] : "",
        role,
        toolName,
        textChars,
        hasStackOverflow,
        excerpt: text.slice(0, 120),
      });
    }
  }

  outliers.sort((a, b) => b.textChars - a.textChars);
  return {
    outliers: outliers.slice(0, limit),
    stackOverflowHits,
  };
}

// ---------------------------------------------------------------------------
// Session file listing + age filter
// ---------------------------------------------------------------------------
