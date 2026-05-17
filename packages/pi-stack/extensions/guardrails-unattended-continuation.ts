/**
 * guardrails-unattended-continuation — opt-in unattended continuation packets.
 *
 * Kept outside guardrails-core so continuation canaries and local-loop packet
 * builders do not inflate the core control-plane startup path.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGuardrailsUnattendedContinuationSurface } from "./guardrails-core-unattended-continuation-surface";

export default function guardrailsUnattendedContinuation(pi: ExtensionAPI): void {
  registerGuardrailsUnattendedContinuationSurface(pi);
}
