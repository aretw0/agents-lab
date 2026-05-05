export interface OperatorVisibleTextContent {
  type: "text";
  text: string;
}

export interface OperatorVisibleToolResponse<TDetails = unknown> {
  content: OperatorVisibleTextContent[];
  details: TDetails;
}

export interface OperatorVisibleOutputOptions<TDetails = unknown> {
  label: string;
  summary?: string;
  details: TDetails;
  includeRawJson?: boolean;
  maxInlineJsonChars?: number;
  detailsHint?: string;
}

const DEFAULT_MAX_INLINE_JSON_CHARS = 1200;
export const OPERATOR_VISIBLE_DETAILS_HINT = "payload completo disponível em details";

function normalizeSummary(label: string, summary?: string): string {
  const compact = String(summary ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length > 0) return compact;
  const fallbackLabel = label.trim() || "operator-visible-output";
  return `${fallbackLabel}: summary unavailable; ${OPERATOR_VISIBLE_DETAILS_HINT}`;
}

function resolveMaxInlineJsonChars(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_INLINE_JSON_CHARS;
  return Math.max(400, Math.min(20_000, Math.floor(value)));
}

function safePrettyJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

export function buildOperatorVisibleToolResponse<TDetails>(
  options: OperatorVisibleOutputOptions<TDetails>,
): OperatorVisibleToolResponse<TDetails> {
  const summary = normalizeSummary(options.label, options.summary);
  const detailsHint = options.detailsHint?.trim() || OPERATOR_VISIBLE_DETAILS_HINT;

  if (!options.includeRawJson) {
    const text = summary.includes(detailsHint) ? summary : `${summary}\n(${detailsHint})`;
    return { content: [{ type: "text", text }], details: options.details };
  }

  const pretty = safePrettyJson(options.details);
  if (!pretty) {
    return {
      content: [{ type: "text", text: `${summary}\n(${detailsHint}; JSON indisponível)` }],
      details: options.details,
    };
  }

  const maxInlineJsonChars = resolveMaxInlineJsonChars(options.maxInlineJsonChars);
  if (pretty.length <= maxInlineJsonChars) {
    return {
      content: [{ type: "text", text: `${summary}\n${pretty}` }],
      details: options.details,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `${summary}\n(JSON compactado: ${pretty.length} chars > ${maxInlineJsonChars}; ${detailsHint})`,
      },
    ],
    details: options.details,
  };
}
