export function normalizeCmdName(text: string): string {
  const t = text.trim();
  if (!t.startsWith("/")) return "";
  const name = t.slice(1).split(/\s+/)[0] ?? "";
  return name.toLowerCase();
}

export function shouldAnnounceStrictInteractiveMode(
  alreadyAnnounced: boolean,
  strictMode: boolean,
): boolean {
  return strictMode && !alreadyAnnounced;
}
