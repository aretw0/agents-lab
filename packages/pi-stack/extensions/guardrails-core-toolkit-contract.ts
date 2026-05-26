import {
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";

export type ToolkitContractProfile = "read-only-review" | "research" | "small-mutation" | "test-fix";
export type ToolkitCapability = "filesystem-read" | "filesystem-write" | "web-research" | "provider-ready" | "focal-validation" | "custom-tools";
export type ToolkitContractNextActionCode = "include-toolkit-contract-in-worker-packet" | "resolve-toolkit-capability-gaps";

export interface ToolkitRequirement {
  capability: ToolkitCapability;
  description: string;
  required: boolean;
}

export interface ToolkitContractInput {
  profile?: ToolkitContractProfile | string;
  goal?: string;
  requiredCapabilities?: ToolkitCapability[];
  availableTools?: string[];
  declaredFiles?: string[];
  providerModelRef?: string;
  validationGateKnown?: boolean;
  purpose?: string;
}

export interface ToolkitContractResult {
  mode: "toolkit-contract";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  processStartAllowed: false;
  requiresOperatorDecision: true;
  decision: "ready-for-operator-decision" | "blocked";
  recommendationCode: "toolkit-contract-ready" | "toolkit-contract-blocked-missing-capabilities";
  nextActionCode: ToolkitContractNextActionCode;
  blockers: string[];
  contract: {
    profile: ToolkitContractProfile;
    purpose: string;
    recommendationCode: "toolkit-contract-ready" | "toolkit-contract-blocked-missing-capabilities";
    nextActionCode: ToolkitContractNextActionCode;
    requiredCapabilities: ToolkitRequirement[];
    availableTools: string[];
    availableCapabilities: ToolkitCapability[];
    satisfied: boolean;
    gapAnalysis: {
      satisfiedCapabilities: ToolkitCapability[];
      missingCapabilities: ToolkitCapability[];
      missingTools: string[];
    };
  };
  nextActions: string[];
  summary: string;
}

const READ_TOOLS = ["read", "grep", "find", "ls"];
const WRITE_TOOLS = ["edit", "write"];
const WEB_TOOLS = ["web_search", "browse_url", "web-browser", "web_browser", "native-web-search"];
const CUSTOM_TOOL_MARKERS = ["bash", "execute_command", "custom_tool"];

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)));
}

function normalizeToolkitProfile(value: unknown): ToolkitContractProfile {
  return value === "research" || value === "small-mutation" || value === "test-fix" || value === "read-only-review" ? value : "read-only-review";
}

function includesAny(values: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => values.includes(candidate));
}

function inferRequiredCapabilities(input: {
  profile: ToolkitContractProfile;
  goal: string;
  purpose: string;
  requiredCapabilities: ToolkitCapability[];
}): ToolkitRequirement[] {
  const requirements = new Map<ToolkitCapability, ToolkitRequirement>();
  const add = (capability: ToolkitCapability, description: string) => {
    requirements.set(capability, { capability, description, required: true });
  };

  add("filesystem-read", "read declared files and inspect the bounded task context");

  if (input.profile === "small-mutation" || input.profile === "test-fix") {
    add("filesystem-write", "edit/write only the declared mutation scope");
  }
  if (input.profile === "test-fix") {
    add("focal-validation", "run or rely on a declared focal validation gate before completion");
  }
  if (input.profile === "research") {
    add("web-research", "perform external/web research with an explicit research tool");
  }

  const text = `${input.goal} ${input.purpose}`.toLowerCase();
  if (/\b(web|internet|search|research|docs? lookup|source lookup)\b/.test(text)) {
    add("web-research", "perform external/web research requested by the step");
  }
  if (/\b(provider|model-specific|api|quota|route)\b/.test(text)) {
    add("provider-ready", "use a declared provider/model with budget/readiness evidence");
  }

  for (const capability of input.requiredCapabilities) {
    add(capability, `operator-declared required capability: ${capability}`);
  }

  return Array.from(requirements.values());
}

function inferAvailableCapabilities(input: {
  availableTools: string[];
  providerModelRef: string;
  validationGateKnown: boolean;
}): ToolkitCapability[] {
  const capabilities: ToolkitCapability[] = [];
  if (READ_TOOLS.every((tool) => input.availableTools.includes(tool))) capabilities.push("filesystem-read");
  if (capabilities.includes("filesystem-read") && WRITE_TOOLS.every((tool) => input.availableTools.includes(tool))) capabilities.push("filesystem-write");
  if (includesAny(input.availableTools, WEB_TOOLS)) capabilities.push("web-research");
  if (input.providerModelRef.includes("/")) capabilities.push("provider-ready");
  if (input.validationGateKnown || input.availableTools.includes("run_tests") || input.availableTools.includes("execute_command")) capabilities.push("focal-validation");
  if (includesAny(input.availableTools, CUSTOM_TOOL_MARKERS)) capabilities.push("custom-tools");
  return capabilities;
}

function missingToolsFor(capability: ToolkitCapability): string[] {
  switch (capability) {
    case "filesystem-read":
      return READ_TOOLS;
    case "filesystem-write":
      return WRITE_TOOLS;
    case "web-research":
      return ["web_search|browse_url|web-browser"];
    case "focal-validation":
      return ["validation gate or run_tests|execute_command"];
    case "provider-ready":
      return ["provider/model budget evidence"];
    case "custom-tools":
      return ["bash|execute_command|custom_tool"];
  }
}

export function buildToolkitContract(input: ToolkitContractInput = {}): ToolkitContractResult {
  const profile = normalizeToolkitProfile(input.profile);
  const goal = normalizeText(input.goal);
  const purpose = normalizeText(input.purpose) || "agent-step";
  const requiredCapabilities = normalizeStringArray(input.requiredCapabilities) as ToolkitCapability[];
  const availableTools = normalizeStringArray(input.availableTools);
  const providerModelRef = normalizeText(input.providerModelRef);
  const validationGateKnown = input.validationGateKnown === true;

  const requirements = inferRequiredCapabilities({ profile, goal, purpose, requiredCapabilities });
  const availableCapabilities = inferAvailableCapabilities({ availableTools, providerModelRef, validationGateKnown });
  const missingCapabilities = requirements
    .filter((requirement) => requirement.required && !availableCapabilities.includes(requirement.capability))
    .map((requirement) => requirement.capability);
  const satisfiedCapabilities = requirements
    .filter((requirement) => availableCapabilities.includes(requirement.capability))
    .map((requirement) => requirement.capability);
  const missingTools = Array.from(new Set(missingCapabilities.flatMap(missingToolsFor)));
  const blockers = missingCapabilities.map((capability) => `missing-required-capability:${capability}`);
  const decision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";
  const recommendationCode = decision === "ready-for-operator-decision" ? "toolkit-contract-ready" : "toolkit-contract-blocked-missing-capabilities";
  const nextActionCode: ToolkitContractNextActionCode = decision === "ready-for-operator-decision"
    ? "include-toolkit-contract-in-worker-packet"
    : "resolve-toolkit-capability-gaps";

  return {
    mode: "toolkit-contract",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    requiresOperatorDecision: true,
    decision,
    recommendationCode,
    nextActionCode,
    blockers,
    contract: {
      profile,
      purpose,
      recommendationCode,
      nextActionCode,
      requiredCapabilities: requirements,
      availableTools,
      availableCapabilities,
      satisfied: blockers.length === 0,
      gapAnalysis: {
        satisfiedCapabilities,
        missingCapabilities,
        missingTools,
      },
    },
    nextActions: decision === "ready-for-operator-decision"
      ? [
          "include the toolkit contract in the worker packet before dispatch",
          "treat later missing-tool reports as contract feedback, not worker failure",
        ]
      : [
          "do not dispatch this step with the current toolkit",
          "add the missing tool/capability, reformulate the step, or ask the operator for the needed resource",
          "retry only after the packet shows the required capabilities are satisfied",
        ],
    summary: [
      "toolkit-contract:",
      `decision=${decision}`,
      `profile=${profile}`,
      `required=${requirements.map((requirement) => requirement.capability).join(",")}`,
      `available=${availableCapabilities.join(",") || "none"}`,
      `nextActionCode=${nextActionCode}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
      "dispatch=no",
    ].filter(Boolean).join(" "),
  };
}
