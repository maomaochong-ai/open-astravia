import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";

export const CODING_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const;

export type CodingToolScope = (typeof CODING_TOOL_SCOPES)[number];

export const DEFAULT_CODING_TOOL_SCOPE: CodingToolScope = "cli";

/**
 * 工具副作用等级（宿主侧元数据，不进 LLM schema）。
 *
 * - `light`（缺省）：只读、可撤销或只影响会话内状态。不用显式写。
 * - `heavy`：在用户工作区创建目录/文件树、产生外部计费、发起不可撤销的外部动作。
 *   产品宿主会在会话内首次调用前向用户确认（见 coding-agent 的 heavy 首调确认闸）。
 *
 * 只在有话要说时显式声明：判 heavy 的工具，或按判据像 heavy 但刻意豁免的工具
 * （显式写 `"light"` 并就近注释理由）。给显然 light 的工具填表只会让声明退化成
 * 无信息量的仪式。
 */
export type CodingToolSideEffect = "light" | "heavy";

export type CodingToolCategory =
	| "core"
	| "doc"
	| "kb-write"
	| "kb-read"
	| "agent-control"
	| "media"
	| "im"
	| "memory"
	| "external";

export interface CodingToolRegistration<TInput extends object = Readonly<Record<string, unknown>>> {
	readonly tool: RuntimeToolDefinition<TInput>;
	readonly scopeUse: readonly CodingToolScope[];
	/**
	 * Session capabilities required for normal scope activation.
	 * Explicit and additionally-enabled activations intentionally bypass this
	 * filter, matching the legacy explicit-tool contract.
	 */
	readonly requires?: readonly string[];
	/** 最终模型工具数组中的稳定顺序；未声明的动态工具保持贡献顺序并排在其后。 */
	readonly modelOrder?: number;
	readonly category: CodingToolCategory;
	/** 缺省 = light；声明契约见 {@link CodingToolSideEffect}。 */
	readonly sideEffect?: CodingToolSideEffect;
}

export type CodingToolActivation =
	| {
			readonly mode: "scope";
			readonly scope?: CodingToolScope;
			readonly additionallyEnabledToolNames?: readonly string[];
			readonly capabilities?: ReadonlySet<string>;
	  }
	| {
			readonly mode: "explicit";
			readonly toolNames: readonly string[];
	  };

export function selectCodingTools(
	registrations: readonly CodingToolRegistration[],
	activation: CodingToolActivation,
): readonly RuntimeToolDefinition[] {
	return selectCodingToolRegistrations(registrations, activation).map(({ tool }) => tool);
}

export function selectCodingToolRegistrations(
	registrations: readonly CodingToolRegistration[],
	activation: CodingToolActivation,
): readonly CodingToolRegistration[] {
	if (activation.mode === "explicit") {
		const explicitlyEnabled = new Set(activation.toolNames);
		return registrations.filter((registration) => explicitlyEnabled.has(registration.tool.name));
	}

	const scope = activation.scope ?? DEFAULT_CODING_TOOL_SCOPE;
	const additionallyEnabled = new Set(activation.additionallyEnabledToolNames ?? []);
	const capabilities = activation.capabilities ?? new Set<string>();
	// 工作模式不参与工具选择（ADR-0071）：激活只看 scopeUse ∩ requires 两条 fail-closed 轴。
	return registrations.filter(
		(registration) =>
			additionallyEnabled.has(registration.tool.name) ||
			(registration.scopeUse.includes(scope) &&
				(registration.requires ?? []).every((capability) => capabilities.has(capability))),
	);
}

export function selectCodingToolsForScope(
	registrations: readonly CodingToolRegistration[],
	scope: CodingToolScope,
	capabilities: ReadonlySet<string> = new Set<string>(),
): readonly RuntimeToolDefinition[] {
	return selectCodingTools(registrations, { mode: "scope", scope, capabilities });
}
