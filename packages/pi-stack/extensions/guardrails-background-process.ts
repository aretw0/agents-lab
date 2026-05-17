/**
 * guardrails-background-process — opt-in background process planning surfaces.
 *
 * Kept outside guardrails-core so process lifecycle diagnostics do not inflate
 * the core control-plane startup path.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGuardrailsBackgroundProcessSurface } from "./guardrails-core-background-process-surface";

export default function guardrailsBackgroundProcess(pi: ExtensionAPI): void {
  registerGuardrailsBackgroundProcessSurface(pi);
}
