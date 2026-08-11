import type { ConversationScenario } from "@vetta/runtime-core";

export type { ConversationScenario } from "@vetta/runtime-core";

export type AgentMode = "work" | "coding";

export const ALL_AGENT_MODES: readonly AgentMode[] = ["work", "coding"];
export const DEFAULT_AGENT_MODE: AgentMode = "work";

export const ALL_SCENARIOS: readonly ConversationScenario[] = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
];

export const DEFAULT_SCENARIO: ConversationScenario = "cli";

export type ToolCapability = "knowledge" | "bg-tasks" | "host:ask";

export type ToolCategory =
	| "core"
	| "doc"
	| "kb-write"
	| "kb-read"
	| "agent-control"
	| "media"
	| "im"
	| "memory"
	| "external";

export interface ToolActivationMetadata {
	readonly name: string;
	readonly scope_use?: readonly string[];
	readonly requires?: readonly string[];
	readonly agent_mode?: readonly string[];
}

export function isAgentMode(value: unknown): value is AgentMode {
	return value === "work" || value === "coding";
}
