import type { ConversationScenario } from "@vetta/runtime-core";
import { type AgentModeId, FILE_MODES } from "./modes-data.js";

export type { ConversationScenario } from "@vetta/runtime-core";

/**
 * 合法工作模式由 `profiles/modes/*.md` 派生（ADR-0071）：新增模式 = 新增一份 md，
 * 此处的联合类型与注册表随 `bun run generate:modes` 自动更新，无需手改。
 */
export type AgentMode = AgentModeId;

export const ALL_AGENT_MODES: readonly AgentMode[] = FILE_MODES.map((mode) => mode.id);
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
}

/**
 * 工具副作用等级（宿主侧元数据，不进 LLM schema）。
 *
 * - `light`：只读、可撤销或只影响会话内状态。
 * - `heavy`：在用户工作区创建目录/文件树、产生外部计费、发起不可撤销的外部动作。
 *   heavy 工具在会话内首次调用前需要用户确认，见 tool-policy/heavy-tool-confirmation.ts。
 *
 * 判定优先级：工具/插件自己的显式声明 > DEFAULT_HEAVY_TOOL_NAMES 兜底清单 > light。
 * 兜底清单不是重副作用工具的完备分类——它只兜「声明通道接通前就存在的核心工具」；
 * 按标准该判 heavy 但刻意不列入的工具，必须在清单旁写就近理由（自带确认、可自愈、
 * 边界由其它机制承担）。命令执行（bash/shell）的边界由 Execution Mode 承担，不归本闸。
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
	return typeof value === "string" && (ALL_AGENT_MODES as readonly string[]).includes(value);
}
