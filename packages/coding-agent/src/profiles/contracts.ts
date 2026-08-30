import type { ConversationScenario } from "../public-api/sdk/sdk-scenario-contract.js";

/** Coding Agent 产品场景；用于产品能力激活与宿主展示，不属于通用 Runtime。 */
export type { ConversationScenario } from "../public-api/sdk/sdk-scenario-contract.js";

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

export function isConversationScenario(value: unknown): value is ConversationScenario {
	return typeof value === "string" && ALL_SCENARIOS.includes(value as ConversationScenario);
}

/** Root Coding Agent 是否启用委派能力的产品策略。 */
export function shouldEnableCodingAgentSubagents(scenario: ConversationScenario): boolean {
	return scenario === "conversation" || scenario === "project" || scenario === "cli";
}

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
	/** 会话场景白名单（fail-closed）：缺省或空数组 = 不激活。 */
	readonly scope_use?: readonly string[];
	/** 必需的 Session capability（fail-closed）：任一缺失即不激活。 */
	readonly requires?: readonly string[];
}
