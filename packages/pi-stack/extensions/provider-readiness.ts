import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface ReadinessResult {
  provider: string;
  modelRef: string;
  status: "ok" | "error" | "untested";
  latencyMs?: number;
  message?: string;
}

function readProviderSettingsFromWorkspace(): Record<string, unknown> {
  try {
    const p = path.join(process.cwd(), ".pi", "settings.json");
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const piStack = (raw.piStack ?? {}) as Record<string, unknown>;
    const quotaVisibility = (piStack.quotaVisibility ?? {}) as Record<string, unknown>;
    return quotaVisibility;
  } catch {
    return {};
  }
}

export default function providerReadinessExtension(pi: ExtensionAPI) {
  const getProviderSettings = () => readProviderSettingsFromWorkspace();

  pi.registerTool({
    name: "provider_readiness_matrix",
    label: "Provider Readiness Matrix",
    description: "Ping routeModelRefs to check for runtime readiness (catches 400s/401s before swarm launch).",
    parameters: Type.Object({
      timeoutMs: Type.Optional(Type.Number({ description: "Timeout per model in ms (default 5000)" })),
      providers: Type.Optional(Type.Array(Type.String(), { description: "Optional list of providers to test. Default: all in routeModelRefs" }))
    }),
    async execute(args) {
      const settings = getProviderSettings();
      const routeModelRefs = settings?.routeModelRefs ?? {};
      const timeoutMs = args.timeoutMs ?? 5000;
      
      const targets = args.providers ?? Object.keys(routeModelRefs);
      const results: ReadinessResult[] = [];

      for (const provider of targets) {
        const modelRef = routeModelRefs[provider];
        if (!modelRef) {
          results.push({ provider, modelRef: "none", status: "untested", message: "No model ref configured" });
          continue;
        }

        try {
          // Parse model ref (provider/id:thinking)
          let refToLoad = modelRef;
          let thinking: string | undefined;
          if (modelRef.includes(":")) {
            const parts = modelRef.split(":");
            refToLoad = parts[0];
            thinking = parts[1];
          }

          const modelConfig = { modelId: refToLoad, thinking };
          const modelInstance = await pi.loadModel(modelConfig);
          if (!modelInstance) {
            results.push({ provider, modelRef, status: "error", message: "Failed to load model instance from pi registry" });
            continue;
          }

          const start = Date.now();
          // We do a tiny ping to check if the upstream API responds with 200 vs 400.
          // Using a minimal maxTokens and a system instruction to output exactly 1 token.
          // Note: If pi.loadModel doesn't expose a raw ping, we use generateText.
          
          let responseOk = false;
          let errMsg = "";
          
          try {
            // Awaiting actual generateText call might take tokens, but we use a tiny maxTokens limit to minimize cost.
            const generateOptions = {
              messages: [{ role: "user", content: "Reply with the single word: OK" }],
              maxTokens: 5,
              abortSignal: AbortSignal.timeout(timeoutMs)
            };
            
            // @ts-ignore - pi-coding-agent extension API generate signature
            if (modelInstance.generate) {
              await modelInstance.generate(generateOptions);
              responseOk = true;
            } else {
              responseOk = false;
              errMsg = "Model adapter lacks generate method";
            }
          } catch (e: any) {
            errMsg = e.message || String(e);
            if (errMsg.includes("400")) errMsg = `HTTP 400 Bad Request (${errMsg})`;
            if (errMsg.includes("401")) errMsg = `HTTP 401 Unauthorized (${errMsg})`;
          }

          const end = Date.now();
          if (responseOk) {
            results.push({ provider, modelRef, status: "ok", latencyMs: end - start });
          } else {
            results.push({ provider, modelRef, status: "error", latencyMs: end - start, message: errMsg });
          }
        } catch (e: any) {
          results.push({ provider, modelRef, status: "error", message: e.message || String(e) });
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ tested: targets.length, timeoutMs, results }, null, 2) }],
        details: results
      };
    }
  });

  pi.registerCommand("provider-matrix", {
    description: "Ping all routeModelRefs to verify upstream readiness.",
    handler: async (args, ctx) => {
      ctx.ui.notify("Testing provider readiness... this may take a moment.", "info");
      
      const settings = getProviderSettings();
      const routeModelRefs = settings?.routeModelRefs ?? {};
      const targets = Object.keys(routeModelRefs);
      
      const lines = ["Provider Readiness Matrix:"];
      let hasErrors = false;

      for (const provider of targets) {
        const modelRef = routeModelRefs[provider];
        if (!modelRef) continue;

        try {
          const modelInstance = await pi.loadModel({ modelId: modelRef.split(":")[0] });
          if (!modelInstance) {
            lines.push(`  ❌ ${provider}: Failed to load model adapter`);
            hasErrors = true;
            continue;
          }

          const generateOptions = {
            messages: [{ role: "user", content: "Reply with exactly one word: OK" }],
            maxTokens: 5,
            abortSignal: AbortSignal.timeout(5000)
          };

          const start = Date.now();
          let success = false;
          let msg = "";
          try {
            // @ts-ignore
            await modelInstance.generate(generateOptions);
            success = true;
          } catch (e: any) {
            msg = e.message || String(e);
          }
          const latency = Date.now() - start;

          if (success) {
            lines.push(`  ✅ ${provider} (${modelRef}) - ${latency}ms`);
          } else {
            lines.push(`  ❌ ${provider} (${modelRef}) - ${latency}ms - ${msg}`);
            hasErrors = true;
          }
        } catch (e: any) {
          lines.push(`  ❌ ${provider} (${modelRef}) - Init error: ${e.message}`);
          hasErrors = true;
        }
      }

      ctx.ui.notify(lines.join("\n"), hasErrors ? "warning" : "info");
    }
  });
}
