/**
 * guardrails-agent-run — opt-in worker orchestration surfaces.
 *
 * Kept outside guardrails-core so the control plane can remain a small runtime
 * boundary while agent-run tooling stays available as a separate surface.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGuardrailsAgentSpawnReadinessSurface } from "./guardrails-core-agent-spawn-readiness-surface";
import { registerColonyPlanPacketSurface } from "./guardrails-core-colony-plan-surface";

export default function guardrailsAgentRun(pi: ExtensionAPI): void {
  registerGuardrailsAgentSpawnReadinessSurface(pi);
  registerColonyPlanPacketSurface(pi);
}
