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
	/** 会话场景白名单（fail-closed）：缺省或空数组 = 不激活。 */
	readonly scope_use?: readonly string[];
	/** 必需的 Session capability（fail-closed）：任一缺失即不激活。 */
	readonly requires?: readonly string[];
	/**
	 * 本工具主推的工作模式 slug。**软引导轴，不是过滤条件**：
	 * 未命中当前模式的工具仍然激活，只会被排到工具清单末尾。缺省/空 = 通用。
	 */
	readonly agent_mode?: readonly string[];
}

/**
 * 工具副作用等级（宿主侧元数据，不进 LLM schema）。
 *
 * - `light`：只读、可撤销或只影响会话内状态。
 * - `heavy`：在用户工作区创建目录/文件树、产生外部计费、发起不可撤销的外部动作。
 *   heavy 工具在会话内首次调用前需要用户确认，见 tool-policy/heavy-tool-confirmation.ts。
 */
export type ToolSideEffect = "light" | "heavy";

export const DEFAULT_TOOL_SIDE_EFFECT: ToolSideEffect = "light";

export function isToolSideEffect(value: unknown): value is ToolSideEffect {
	return value === "light" || value === "heavy";
}

/** 归一化来自 manifest / 插件贡献等外部边界的 side_effect 声明；无效值返回 undefined（= 未声明）。 */
export function normalizeToolSideEffect(value: unknown): ToolSideEffect | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return isToolSideEffect(normalized) ? normalized : undefined;
}

export function isAgentMode(value: unknown): value is AgentMode {
	return value === "work" || value === "coding";
}
