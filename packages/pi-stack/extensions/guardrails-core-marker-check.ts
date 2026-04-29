export interface TextMarkerCheckInput {
  text: string;
  markers: string[];
  normalizeAccents?: boolean;
  caseSensitive?: boolean;
  forbidCommandSensitiveMarkers?: boolean;
}

export interface CommandSensitiveMarker {
  marker: string;
  reasons: string[];
}

export interface TextMarkerCheckResult {
  ok: boolean;
  matched: string[];
  missing: string[];
  commandSensitiveMarkers: CommandSensitiveMarker[];
  summary: string;
}

function normalizeText(value: string, options: { normalizeAccents: boolean; caseSensitive: boolean }): string {
  let output = String(value ?? "");
  if (options.normalizeAccents) output = output.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!options.caseSensitive) output = output.toLowerCase();
  return output;
}

export function detectCommandSensitiveMarkerReasons(marker: string): string[] {
  const reasons: string[] = [];
  if (marker.includes("`")) reasons.push("backtick");
  if (marker.includes("$(")) reasons.push("command-substitution");
  if (marker.includes("\n") || marker.includes("\r")) reasons.push("newline");
  return reasons;
}

export function detectShellInlineCommandSensitiveMarkerCheck(command: string): boolean {
  const normalized = String(command ?? "").toLowerCase();
  const invokesInlineEvaluator = /\b(?:node|python|python3)\b[\s\S]*(?:\s-e\b|\s-c\b)/i.test(command)
    || /\b(?:node|python|python3)\b[\s\S]*(?:eval|exec)/i.test(command);
  if (!invokesInlineEvaluator) return false;

  const markerLike = /\bmarkers?\b|\.includes\s*\(|\.indexof\s*\(|readfilesync\s*\(/i.test(command)
    || normalized.includes("missing ")
    || normalized.includes("marker-check");
  if (!markerLike) return false;

  return detectCommandSensitiveMarkerReasons(command).length > 0;
}

export function commandSensitiveShellMarkerCheckReason(): string {
  return [
    "Blocked by guardrails-core (safe_marker_check): shell-inline marker checks with command-sensitive syntax are a recurring failure path.",
    "Use safe_marker_check for runtime file markers, or evaluateTextMarkerCheck inside tests/code.",
  ].join(" ");
}

export function evaluateTextMarkerCheck(input: TextMarkerCheckInput): TextMarkerCheckResult {
  const options = {
    normalizeAccents: input.normalizeAccents === true,
    caseSensitive: input.caseSensitive !== false,
  };
  const markers = Array.isArray(input.markers) ? input.markers.filter((marker): marker is string => typeof marker === "string") : [];
  const normalizedText = normalizeText(input.text, options);
  const matched: string[] = [];
  const missing: string[] = [];
  const commandSensitiveMarkers: CommandSensitiveMarker[] = [];

  for (const marker of markers) {
    const reasons = detectCommandSensitiveMarkerReasons(marker);
    if (reasons.length > 0) commandSensitiveMarkers.push({ marker, reasons });
    const normalizedMarker = normalizeText(marker, options);
    if (normalizedMarker.length > 0 && normalizedText.includes(normalizedMarker)) {
      matched.push(marker);
    } else {
      missing.push(marker);
    }
  }

  const unsafeCount = commandSensitiveMarkers.length;
  const blockedByPolicy = input.forbidCommandSensitiveMarkers === true && unsafeCount > 0;
  const ok = missing.length === 0 && !blockedByPolicy;

  return {
    ok,
    matched,
    missing,
    commandSensitiveMarkers,
    summary: `marker-check: ok=${ok ? "yes" : "no"} matched=${matched.length}/${markers.length} missing=${missing.length > 0 ? missing.length : "none"} commandSensitive=${unsafeCount > 0 ? unsafeCount : "none"}`,
  };
}
